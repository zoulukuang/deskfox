import { useMarked } from "../context/marked"
import { useI18n } from "../context/i18n"
import DOMPurify from "dompurify"
import morphdom from "morphdom"
import { checksum } from "@opencode-ai/core/util/encode"
import {
  ComponentProps,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  createUniqueId,
  onCleanup,
  splitProps,
} from "solid-js"
import { isServer } from "solid-js/web"
import { bundledLanguages } from "shiki"
import { canReusePendingBlock, project, type Block, type Projection } from "./markdown-stream"
import {
  disposeStreamingCode,
  highlightStreamingCode,
  MarkdownWorkerDisposedError,
  MarkdownWorkerSupersededError,
  MarkdownWorkerUnavailableError,
} from "./markdown-worker"
import { markdownBlockKey, type MarkdownToken } from "./markdown-worker-protocol"
import { shouldResetCodeTokens, type RenderedCodeState } from "./markdown-code-state"

type Entry = {
  raw: string
  hash: string
  html: string
}

type RenderedBlock =
  | (Entry & { key: string; mode: Exclude<Block["mode"], "code"> })
  | {
      key: string
      mode: "code"
      raw: string
      hash: string
      language: string
      complete: boolean
      generation: number
      stable: MarkdownToken[]
      unstable: MarkdownToken[]
    }

type RenderResult = {
  text: string
  blocks: RenderedBlock[]
}

const max = 200
const cache = new Map<string, Entry>()
const renderedCodeTokens = new WeakMap<HTMLDivElement, RenderedCodeState>()

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

const config = {
  // FORK: 加 svg + svgFilters 让 marked-alert 的图标存活 + mermaid SVG 也通(虽然 mermaid 走 post-sanitize 路径) 2026-05-05
  USE_PROFILES: { html: true, mathMl: true, svg: true, svgFilters: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
  // FORK: ADD_TAGS svg/path 上游所加;ADD_ATTR 取并集 —— 上游 svg 属性 + fork data-mermaid-pending(decorate 转 data-mermaid-source) [feat: electron-replatform]
  ADD_TAGS: ["svg", "path"],
  ADD_ATTR: ["data-mermaid-pending", "d", "viewBox", "preserveAspectRatio", "xmlns", "target"],
}

const iconPaths = {
  copy: '<path d="M6.2513 6.24935V2.91602H17.0846V13.7493H13.7513M13.7513 6.24935V17.0827H2.91797V6.24935H13.7513Z" stroke="currentColor" stroke-linecap="round"/>',
  check: '<path d="M5 11.9657L8.37838 14.7529L15 5.83398" stroke="currentColor" stroke-linecap="square"/>',
}

function sanitize(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

function escape(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fallback(markdown: string) {
  return escape(markdown).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>")
}

async function code(text: string, language: string | undefined, key: string, complete = false) {
  const name = language && language in bundledLanguages ? language : "text"
  try {
    const result = await highlightStreamingCode(key, text, name, complete)
    return { language: name, generation: result.generation, stable: result.stable, unstable: result.unstable }
  } catch (error) {
    if (
      !(error instanceof MarkdownWorkerDisposedError) &&
      !(error instanceof MarkdownWorkerSupersededError) &&
      !(error instanceof MarkdownWorkerUnavailableError)
    )
      console.error("Markdown highlighting worker failed", error)
    return { language: name, generation: 0, stable: [], unstable: [[text, ""] as MarkdownToken] }
  }
}

type CopyLabels = {
  copy: string
  copied: string
}

const urlPattern = /^https?:\/\/[^\s<>()`"']+$/

function codeUrl(text: string) {
  const href = text.trim().replace(/[),.;!?]+$/, "")
  if (!urlPattern.test(href)) return
  try {
    const url = new URL(href)
    return url.toString()
  } catch {
    return
  }
}

function createIcon(path: string, slot: string) {
  const icon = document.createElement("div")
  icon.setAttribute("data-component", "icon")
  icon.setAttribute("data-size", "small")
  icon.setAttribute("data-slot", slot)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("data-slot", "icon-svg")
  svg.setAttribute("fill", "none")
  svg.setAttribute("viewBox", "0 0 20 20")
  svg.setAttribute("aria-hidden", "true")
  svg.innerHTML = path
  icon.appendChild(svg)
  return icon
}

function createCopyButton(labels: CopyLabels) {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("data-component", "icon-button")
  button.setAttribute("data-variant", "secondary")
  button.setAttribute("data-size", "small")
  button.setAttribute("data-slot", "markdown-copy-button")
  button.setAttribute("aria-label", labels.copy)
  button.setAttribute("data-tooltip", labels.copy)
  button.appendChild(createIcon(iconPaths.copy, "copy-icon"))
  button.appendChild(createIcon(iconPaths.check, "check-icon"))
  return button
}

function setCopyState(button: HTMLButtonElement, labels: CopyLabels, copied: boolean) {
  if (copied) {
    button.setAttribute("data-copied", "true")
    button.setAttribute("aria-label", labels.copied)
    button.setAttribute("data-tooltip", labels.copied)
    return
  }
  button.removeAttribute("data-copied")
  button.setAttribute("aria-label", labels.copy)
  button.setAttribute("data-tooltip", labels.copy)
}

function ensureCodeWrapper(block: HTMLPreElement, labels: CopyLabels) {
  const parent = block.parentElement
  if (!parent) return
  const wrapped = parent.getAttribute("data-component") === "markdown-code"
  if (!wrapped) {
    const wrapper = document.createElement("div")
    wrapper.setAttribute("data-component", "markdown-code")
    parent.replaceChild(wrapper, block)
    wrapper.appendChild(block)
    wrapper.appendChild(createCopyButton(labels))
    return
  }

  const buttons = Array.from(parent.querySelectorAll('[data-slot="markdown-copy-button"]')).filter(
    (el): el is HTMLButtonElement => el instanceof HTMLButtonElement,
  )

  if (buttons.length === 0) {
    parent.appendChild(createCopyButton(labels))
    return
  }

  for (const button of buttons.slice(1)) {
    button.remove()
  }
}

function markCodeLinks(root: HTMLDivElement) {
  const codeNodes = Array.from(root.querySelectorAll(":not(pre) > code"))
  for (const code of codeNodes) {
    const href = codeUrl(code.textContent ?? "")
    const parentLink =
      code.parentElement instanceof HTMLAnchorElement && code.parentElement.classList.contains("external-link")
        ? code.parentElement
        : null

    if (!href) {
      if (parentLink) parentLink.replaceWith(code)
      continue
    }

    if (parentLink) {
      parentLink.href = href
      continue
    }

    const link = document.createElement("a")
    link.href = href
    link.className = "external-link"
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    code.parentNode?.replaceChild(link, code)
    link.appendChild(code)
  }
}

// FORK: Mermaid ```mermaid 代码块 → SVG 流程图 2026-05-05
// 设计(修正版,2026-05-05 P0 fix):
//   1. marked.tsx 的 markedShiki highlight callback 拦 lang==="mermaid",
//      直接返回 <div data-mermaid-pending=""> 含 escaped source(跳过 shiki 高亮)
//   2. DOMPurify 经过 — sanitize 保留 data-mermaid-pending 属性
//   3. decorate 同步处理 — 把 textContent(原始 source)挪到 data-mermaid-source attr,
//      改 placeholder 文本为"渲染流程图中…",清 pending 标志
//   4. 异步 dynamic import('mermaid')(vite chunk split,runtime 0 网络)
//   5. mermaid.render(id, source) → SVG;失败回退源码
//   6. morphdom 守卫:已渲染的(无 data-mermaid-source)不被新 placeholder 覆盖回
function setupMermaidPlaceholders(root: HTMLDivElement) {
  const pending = Array.from(root.querySelectorAll<HTMLElement>("[data-mermaid-pending]"))
  for (const el of pending) {
    const source = el.textContent ?? ""
    el.setAttribute("data-mermaid-source", source)
    el.removeAttribute("data-mermaid-pending")
    el.classList.add("markdown-mermaid")
    el.style.cssText = "padding: 1rem; opacity: 0.6; font-size: 0.85rem;"
    el.textContent = "渲染流程图中…"
  }
}

// FORK: 修 SANITIZE_NAMED_PROPS=true 引发的锚点跳转失效 2026-05-05
// DOMPurify SANITIZE_NAMED_PROPS 会把 id 加 "user-content-" 前缀防 DOM clobbering,
// 但内部 <a href="#X"> 的 href 不会同步更新 → 脚注 / 锚点点击跳不动。
// 后置扫所有 [id^="user-content-"],把对应 href="#原id" 改成 href="#user-content-原id"。
function fixSanitizeNamedPropHrefs(root: HTMLDivElement) {
  const idMap = new Map<string, string>()
  for (const el of Array.from(root.querySelectorAll("[id]"))) {
    const id = (el as HTMLElement).id
    if (id.startsWith("user-content-")) {
      const stripped = id.slice("user-content-".length)
      idMap.set(stripped, id)
    }
  }
  if (idMap.size === 0) return
  for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))) {
    const href = link.getAttribute("href") ?? ""
    if (!href.startsWith("#")) continue
    const target = href.slice(1)
    const newId = idMap.get(target)
    if (newId) {
      link.setAttribute("href", "#" + newId)
    }
  }
}

// FORK: 相对路径 <a> 链接去掉 target=_blank — 否则 Tauri 把 _blank 路由到系统浏览器 2026-05-05
// marked.tsx 的 link renderer 给所有 <a> 加 target=_blank,但相对路径(./other.md)
// 应在 file viewer 内部通过 onOpenTab 跳转,不能开浏览器。
// 顺便加 title 提示 — hover 时让 user 直观知道点击是"内部跳"还是"外部打开"。
function fixLinkTargets(root: HTMLDivElement) {
  const links = Array.from(root.querySelectorAll("a"))
  for (const link of links) {
    const href = link.getAttribute("href") ?? ""
    if (!href) continue
    // 外链(http/https/mailto/ftp/tel)保持 target=_blank
    if (/^(https?|mailto|ftp|tel):/i.test(href)) {
      if (!link.title) link.title = "在浏览器打开:" + href
      continue
    }
    // 相对路径 / 锚点(#xxx)→ 去掉 target/rel,改用 internal-link class 区分样式
    link.removeAttribute("target")
    link.removeAttribute("rel")
    link.classList.remove("external-link")
    link.classList.add("internal-link")
    if (!link.title) link.title = "在文件查看器打开:" + href
  }
}

let mermaidLoader: Promise<unknown> | null = null
async function loadMermaid(): Promise<{ render: (id: string, src: string) => Promise<{ svg: string }> }> {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then((mod) => {
      const lib: any = (mod as any).default ?? mod
      lib.initialize?.({
        startOnLoad: false,
        theme: "default",
        securityLevel: "strict", // mermaid 内部 sanitize,SVG 输出不含 script
        flowchart: { htmlLabels: false },
        fontFamily: "var(--font-sans, sans-serif)",
      })
      return lib
    })
  }
  return mermaidLoader as Promise<{ render: (id: string, src: string) => Promise<{ svg: string }> }>
}

async function renderMermaidIn(container: HTMLElement) {
  const placeholders = Array.from(container.querySelectorAll<HTMLElement>("[data-mermaid-source]"))
  if (placeholders.length === 0) return
  let mermaid: { render: (id: string, src: string) => Promise<{ svg: string }> }
  try {
    mermaid = await loadMermaid()
  } catch {
    // 加载失败(理论上 0 网络不会发生):退回源码
    for (const el of placeholders) {
      fallbackToSource(el)
      el.removeAttribute("data-mermaid-source")
    }
    return
  }
  for (let i = 0; i < placeholders.length; i++) {
    const el = placeholders[i]
    const src = el.getAttribute("data-mermaid-source") ?? ""
    if (!src.trim()) {
      el.removeAttribute("data-mermaid-source")
      continue
    }
    const id = `mermaid-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`
    try {
      const { svg } = await mermaid.render(id, src)
      el.removeAttribute("style")
      el.classList.add("markdown-mermaid-rendered")
      el.innerHTML = svg
    } catch {
      // 语法错或不支持 — 容错回退源码
      fallbackToSource(el, src)
    }
    el.removeAttribute("data-mermaid-source")
  }
}

function fallbackToSource(el: HTMLElement, src?: string) {
  const source = src ?? el.getAttribute("data-mermaid-source") ?? ""
  el.removeAttribute("style")
  el.classList.add("markdown-mermaid-error")
  el.innerHTML = ""
  const pre = document.createElement("pre")
  const code = document.createElement("code")
  code.className = "language-mermaid"
  code.textContent = source
  pre.appendChild(code)
  el.appendChild(pre)
}

// FORK: 本地资源 src 重写(.md 内 <img>/<video>/<audio>/<source>)2026-05-05
// 把相对路径 src 转为 localasset:// URL,文件查看器侧传入 rewriteAssetSrc;
// 聊天侧不传 → 此函数 no-op,无回归
function rewriteAssetSources(root: HTMLDivElement, rewriter: (src: string) => string | null) {
  const elements = Array.from(root.querySelectorAll("img, video, audio, source"))
  for (const el of elements) {
    const src = el.getAttribute("src")
    if (!src) continue
    const next = rewriter(src)
    if (next) el.setAttribute("src", next)
  }
  // 处理 <video poster="...">(海报图)
  const videos = Array.from(root.querySelectorAll("video[poster]"))
  for (const v of videos) {
    const poster = v.getAttribute("poster")
    if (!poster) continue
    const next = rewriter(poster)
    if (next) v.setAttribute("poster", next)
  }
  // 处理 <picture><source srcset="...">(可选:此处只处理单 src;复杂 srcset 解析推迟)
  // 处理 inline <a href="./local.md">(MD 内链跳转 — Phase 4 再统一)
}

// FORK: 给 H1-H6 注入 id(锚点跳转 + TOC 面板需要)2026-05-05
function assignHeadingIds(root: HTMLDivElement) {
  const headings = root.querySelectorAll("h1, h2, h3, h4, h5, h6")
  let counter = 0
  for (const h of Array.from(headings)) {
    if (!h.id) {
      h.id = `md-h-${++counter}`
    }
  }
}

function decorate(
  root: HTMLDivElement,
  labels: CopyLabels,
  rewriter?: (src: string) => string | null,
) {
  // FORK: Mermaid 占位 — 转 data-mermaid-pending → data-mermaid-source 2026-05-05
  setupMermaidPlaceholders(root)
  // FORK: heading id 注入 — #anchor 跳转用 2026-05-05
  assignHeadingIds(root)
  // FORK: 修 DOMPurify SANITIZE_NAMED_PROPS 把 id 加前缀但 href 不同步 → 脚注跳转失效 2026-05-05
  fixSanitizeNamedPropHrefs(root)
  // FORK: 相对路径 <a> 去掉 target=_blank,防 Tauri 把内链打开浏览器 2026-05-05
  fixLinkTargets(root)
  const blocks = Array.from(root.querySelectorAll("pre"))
  for (const block of blocks) {
    ensureCodeWrapper(block, labels)
  }
  markCodeLinks(root)
  if (rewriter) rewriteAssetSources(root, rewriter)
}

function setupCodeCopy(root: HTMLDivElement, getLabels: () => CopyLabels) {
  const timeouts = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()

  const updateLabel = (button: HTMLButtonElement) => {
    const labels = getLabels()
    const copied = button.getAttribute("data-copied") === "true"
    setCopyState(button, labels, copied)
  }

  const handleClick = async (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const button = target.closest('[data-slot="markdown-copy-button"]')
    if (!(button instanceof HTMLButtonElement)) return
    const code = button.closest('[data-component="markdown-code"]')?.querySelector("code")
    const content = code?.textContent ?? ""
    if (!content) return
    const clipboard = navigator?.clipboard
    if (!clipboard) return
    await clipboard.writeText(content)
    const labels = getLabels()
    setCopyState(button, labels, true)
    const existing = timeouts.get(button)
    if (existing) clearTimeout(existing)
    const timeout = setTimeout(() => setCopyState(button, labels, false), 2000)
    timeouts.set(button, timeout)
  }

  const buttons = Array.from(root.querySelectorAll('[data-slot="markdown-copy-button"]'))
  for (const button of buttons) {
    if (button instanceof HTMLButtonElement) updateLabel(button)
  }

  root.addEventListener("click", handleClick)

  return () => {
    root.removeEventListener("click", handleClick)
    for (const timeout of timeouts.values()) {
      clearTimeout(timeout)
    }
  }
}

function touch(key: string, value: Entry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

function initialResult(text: string, key: string | undefined, projection: Projection, owner: string): RenderResult {
  if (!text) return { text, blocks: [] }
  const base = key ?? checksum(text)
  if (base) {
    const blocks = projection.blocks.flatMap((block, index) => {
      if (block.mode === "code") return []
      const cacheKey = `${base}:${index}:${block.mode}`
      const cached = cache.get(cacheKey)
      if (cached?.raw !== block.raw) return []
      return [{ key: `${owner}:${cacheKey}`, mode: block.mode, ...cached }]
    })
    if (blocks.length === projection.blocks.length) return { text, blocks }
  }
  return {
    text,
    blocks: [
      {
        key: "initial",
        mode: "full",
        raw: text,
        hash: checksum(text) ?? "",
        html: fallback(text),
      },
    ],
  }
}

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    cacheKey?: string
    streaming?: boolean
    class?: string
    classList?: Record<string, boolean>
    // FORK: 本地资源 src 重写钩子(文件查看器传入,聊天侧不传)2026-05-05
    rewriteAssetSrc?: (src: string) => string | null
  },
) {
  const [local, others] = splitProps(props, [
    "text",
    "cacheKey",
    "streaming",
    "class",
    "classList",
    "rewriteAssetSrc",
  ])
  const marked = useMarked()
  const i18n = useI18n()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const owner = createUniqueId()
  const activeCodeKeys = new Set<string>()
  const completedCode = new Map<string, Extract<RenderedBlock, { mode: "code" }>>()
  const projection = createMemo((previous: Projection | undefined) =>
    project(previous, local.text, local.streaming ?? false),
  )
  const [html] = createResource(
    () => {
      return {
        text: local.text,
        key: local.cacheKey,
        projection: projection(),
      }
    },
    async (src) => {
      if (isServer)
        return {
          text: src.text,
          blocks: [
            {
              key: "server",
              mode: "full" as const,
              raw: src.text,
              hash: checksum(src.text) ?? "",
              html: fallback(src.text),
            },
          ],
        } satisfies RenderResult
      if (!src.text) return { text: src.text, blocks: [] } satisfies RenderResult

      const base = src.key ?? checksum(src.text)
      return Promise.all(
        src.projection.blocks.map(async (block, index) => {
          const key = base ? `${base}:${index}:${block.mode}` : undefined
          const blockKey = markdownBlockKey(owner, src.key, index, block.mode)

          if (block.mode === "code") {
            // FORK-BEGIN: mermaid 围栏不走 shiki 流式高亮 — 完整块直接产 data-mermaid-pending 占位,
            //   复用 decorate → renderMermaidIn 既有管线;流式未闭合期间仍走 code 高亮,闭合后换占位。
            //   (2026-08-11 移植:上游块式架构把所有围栏拆成 code 块绕过 marked,原 marked.tsx
            //   highlight 拦截对 code 块失效,故在此层拦)
            if (block.language === "mermaid" && block.complete) {
              const escaped = block.src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
              return {
                key: blockKey,
                mode: "full" as const,
                raw: block.raw,
                hash: checksum(block.raw) ?? String(block.raw.length),
                html: sanitize(`<div data-component="markdown-mermaid" data-mermaid-pending="">${escaped}</div>`),
              }
            }
            // FORK-END
            const cached = completedCode.get(blockKey)
            if (block.complete && cached?.raw === block.raw) return cached
            const result = await code(block.src, block.language, blockKey, block.complete)
            const rendered = {
              key: blockKey,
              mode: block.mode,
              raw: block.raw,
              hash: String(block.raw.length),
              complete: !!block.complete,
              ...result,
            }
            if (block.complete) completedCode.set(blockKey, rendered)
            return rendered
          }

          if (key) {
            const cached = cache.get(key)
            if (cached?.raw === block.raw) {
              touch(key, cached)
              return { key: blockKey, mode: block.mode, ...cached }
            }
          }

          const hash = checksum(block.raw)
          const safe = sanitize(await Promise.resolve(marked.parse(block.src)))
          if (key && hash) touch(key, { raw: block.raw, hash, html: safe })
          return { key: blockKey, mode: block.mode, raw: block.raw, hash: hash ?? "", html: safe }
        }),
      )
        .then((blocks) => ({ text: src.text, blocks }) satisfies RenderResult)
        .catch(
          () =>
            ({
              text: src.text,
              blocks: [
                {
                  key: base ?? "fallback",
                  mode: "full" as const,
                  raw: src.text,
                  hash: checksum(src.text) ?? "",
                  html: fallback(src.text),
                },
              ],
            }) satisfies RenderResult,
        )
    },
    {
      initialValue: initialResult(local.text, local.cacheKey, projection(), owner),
    },
  )

  let copyCleanup: (() => void) | undefined

  createEffect(() => {
    const container = root()
    const result = html.latest ?? html()
    const projected = projection()
    const content = local.text ? pendingBlocks(result, projected, local.cacheKey, owner) : []
    if (!container) return
    if (isServer) return
    if (content.length === 0) {
      container.innerHTML = ""
      return
    }

    const labels = {
      copy: i18n.t("ui.message.copy"),
      copied: i18n.t("ui.message.copied"),
    }
    const nextCodeKeys = new Set(content.filter((block) => block.mode === "code").map((block) => block.key))
    activeCodeKeys.forEach((key) => {
      if (!nextCodeKeys.has(key)) disposeCode(key)
    })
    activeCodeKeys.clear()
    nextCodeKeys.forEach((key) => activeCodeKeys.add(key))
    // FORK: updateBlock 多传 rewriteAssetSrc — 本地资源 src 重写穿透到块级 decorate 2026-08-11
    content.forEach((block, index) => updateBlock(container, index, block, labels, local.rewriteAssetSrc))
    while (container.children.length > content.length) container.lastElementChild?.remove()
    container
      .querySelectorAll<HTMLButtonElement>('[data-slot="markdown-copy-button"]')
      .forEach((button) => setCopyState(button, labels, button.dataset.copied === "true"))
    // FORK: 异步渲染所有 mermaid placeholder(dynamic import,vite chunk;0 网络请求)2026-05-05;
    //   2026-08-11 移植到上游块式增量渲染架构(每次块更新后统一扫容器)
    void renderMermaidIn(container)
    if (!copyCleanup)
      copyCleanup = setupCodeCopy(container, () => ({
        copy: i18n.t("ui.message.copy"),
        copied: i18n.t("ui.message.copied"),
      }))
  })

  onCleanup(() => {
    if (copyCleanup) copyCleanup()
    activeCodeKeys.forEach(disposeCode)
    completedCode.clear()
  })

  return (
    <div
      data-component="markdown"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      ref={setRoot}
      {...others}
    />
  )
}

function pendingBlocks(
  result: RenderResult | undefined,
  projection: Projection | undefined,
  cacheKey: string | undefined,
  owner: string,
) {
  if (!result) return []
  if (!projection || result.text === projection.text) return result.blocks
  const initial = result.blocks.length === 1 && result.blocks[0]?.key === "initial"
  return projection.blocks.map((block, index) => {
    const current = initial ? undefined : result.blocks[index]
    if (current && canReusePendingBlock(current, block)) return current
    const key = markdownBlockKey(owner, cacheKey, index, block.mode)
    if (block.mode !== "code")
      return { key, mode: block.mode, raw: block.raw, hash: String(block.raw.length), html: fallback(block.src) }
    return {
      key,
      mode: block.mode,
      raw: block.raw,
      hash: String(block.raw.length),
      language: block.language ?? "text",
      complete: !!block.complete,
      stable: [],
      generation: 0,
      unstable: [[block.src, ""] as MarkdownToken],
    }
  })
}

function disposeCode(key: string) {
  disposeStreamingCode(key)
}

function updateBlock(
  container: HTMLDivElement,
  index: number,
  block: RenderedBlock,
  labels: CopyLabels,
  // FORK: 本地资源 src 重写回调穿透(文件查看器传入)2026-08-11
  rewriter?: (src: string) => string | null,
) {
  const current = container.children[index]
  if (block.mode === "code") {
    updateCodeBlock(container, current, block, labels)
    return
  }
  if (
    current instanceof HTMLDivElement &&
    current.dataset.markdownKey === block.key &&
    current.dataset.markdownHash === block.hash
  )
    return

  const next = document.createElement("div")
  next.dataset.markdownBlock = ""
  next.dataset.markdownKey = block.key
  next.dataset.markdownHash = block.hash
  next.style.display = "contents"
  next.innerHTML = block.html
  decorate(next, labels, rewriter)

  if (!(current instanceof HTMLDivElement)) {
    container.appendChild(next)
    return
  }

  morphdom(current, next, {
    onBeforeElUpdated: (fromEl, toEl) => {
      if (
        fromEl instanceof HTMLButtonElement &&
        toEl instanceof HTMLButtonElement &&
        fromEl.getAttribute("data-slot") === "markdown-copy-button" &&
        toEl.getAttribute("data-slot") === "markdown-copy-button"
      ) {
        return false
      }
      // FORK: 已渲染的 mermaid(无 data-mermaid-source 属性)不被新 placeholder 覆盖回 2026-05-05(块式架构移植 2026-08-11)
      if (
        fromEl instanceof HTMLElement &&
        toEl instanceof HTMLElement &&
        fromEl.getAttribute("data-component") === "markdown-mermaid" &&
        toEl.getAttribute("data-component") === "markdown-mermaid" &&
        !fromEl.hasAttribute("data-mermaid-source")
      ) {
        // 已 render 的不动,新 placeholder(toEl)被丢弃
        return false
      }
      if (fromEl.isEqualNode(toEl)) return false
      return true
    },
  })
}

function updateCodeBlock(
  container: HTMLDivElement,
  current: Element | undefined,
  block: Extract<RenderedBlock, { mode: "code" }>,
  labels: CopyLabels,
) {
  const existing = current instanceof HTMLDivElement && current.dataset.markdownKey === block.key ? current : undefined
  const next = existing ?? document.createElement("div")
  next.dataset.markdownBlock = ""
  next.dataset.markdownKey = block.key
  next.dataset.markdownHash = block.hash
  next.dataset.markdownComplete = block.complete ? "true" : "false"
  next.style.display = "contents"

  const code = existing?.querySelector("code")
  if (code instanceof HTMLElement) {
    code.className = `language-${block.language}`
    const previous = renderedCodeTokens.get(next)
    const reset = shouldResetCodeTokens(previous, {
      language: block.language,
      generation: block.generation,
      stableCount: block.stable.length,
      raw: block.raw,
    })
    const stableCount = reset ? 0 : previous!.stableCount
    const tail = [...block.stable.slice(stableCount), ...block.unstable]
    const prior = reset ? [] : previous!.unstable
    const prefix = prior.findIndex((token, index) => !sameToken(token, tail[index]))
    const keep = stableCount + (prefix < 0 ? Math.min(prior.length, tail.length) : prefix)
    while (code.children.length > keep) code.lastElementChild?.remove()
    tail
      .slice(keep - stableCount)
      .map(createTokenSpan)
      .forEach((span) => code.appendChild(span))
    renderedCodeTokens.set(next, {
      language: block.language,
      generation: block.generation,
      stableCount: block.stable.length,
      unstable: block.unstable,
      raw: block.raw,
    })
    return
  }

  const wrapper = document.createElement("div")
  wrapper.setAttribute("data-component", "markdown-code")
  const pre = document.createElement("pre")
  pre.className = "shiki OpenCode"
  const codeElement = document.createElement("code")
  codeElement.className = `language-${block.language}`
  ;[...block.stable, ...block.unstable].map(createTokenSpan).forEach((span) => codeElement.appendChild(span))
  pre.appendChild(codeElement)
  wrapper.appendChild(pre)
  wrapper.appendChild(createCopyButton(labels))
  next.appendChild(wrapper)
  renderedCodeTokens.set(next, {
    language: block.language,
    generation: block.generation,
    stableCount: block.stable.length,
    unstable: block.unstable,
    raw: block.raw,
  })
  if (current) current.replaceWith(next)
  else container.appendChild(next)
}

function sameToken(left: MarkdownToken, right: MarkdownToken | undefined) {
  return !!right && left[0] === right[0] && left[1] === right[1]
}

function createTokenSpan(token: MarkdownToken) {
  const span = document.createElement("span")
  span.setAttribute("style", token[1])
  span.textContent = token[0]
  return span
}
