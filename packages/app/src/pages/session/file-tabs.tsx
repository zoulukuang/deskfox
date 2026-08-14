import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic, Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode-ai/session-ui/file"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/session-ui/pierre/selection-bridge"
import { createLineCommentController } from "@opencode-ai/session-ui/line-comment-annotations"
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@opencode-ai/ui/toast"
import { invoke, isDesktopApp, listen } from "@/utils/native"
import { createMdLinkClickHandler } from "@/pages/session/md-link-click"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useSDK } from "@/context/sdk"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
// FORK: .md 导出 Word [feat: md-export-pdf-word] 2026-05-05
// PDF 路线 v1 drop(Tauri WKWebView window.print silent,见 spec §9.6)
import { exportMdAsDocx } from "@/utils/md-export-docx"
import { getSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"
import CodeMirrorView, { type CursorInfo } from "@/components/code-mirror-view"
// FORK: md-editing-iter-2 — 编辑态状态栏(行/列/选中字符数)2026-05-09
import CmStatusBar from "@/components/cm-status-bar"
import { langFromExt } from "@/utils/lang-from-ext"
// FORK: .md 编辑增强(列表续延 / Ctrl+B/I/K / 拖图 / 智能粘贴 / Ctrl+F 等)2026-05-05
import { markdownEditorExtensions } from "@/utils/markdown-editor-extensions"
import { isBinary, isOfficeDocument, tooLarge } from "@/utils/file-limits"
// FORK: CSV/TSV 表格查看器(新功能,user 拍板)[feat: csv-table-viewer] 2026-06-14
import { CsvTable } from "@/components/csv-table"
// FORK: 选区 overlay 几何工具(CSV 裁剪 + iframe 投影)[feat: viewer-selection-tray-style]
import { clampRectsToBounds, projectIframeRects } from "./selection-overlay"
// FORK: 本地资源 protocol(.md 内 <img>/<video>/<audio> 重写 + HTML 预览 iframe)2026-05-05
import { localAssetUrl, rewriteAssetSrc } from "@/utils/local-asset"
// FORK: 大文件预览统一防护 — L4 UX 兜底组件 [feat: large-file-preview-guard] 2026-05-21
import { FileTooLarge } from "@/components/file-too-large"
// FORK: debounce auto-save + flush [feat: auto-save-debounce-flush] 2026-05-21
import { createDebounced } from "@/utils/debounce"
// FORK: .md frontmatter 隐藏(Obsidian 风)2026-05-05
import { stripFrontmatter } from "@/utils/markdown-frontmatter"
// FORK: 聊天输入框焦点跟随 [feat: chat-input-focus-follow] 2026-05-21
import { focusChatInput } from "@/utils/chat-input-focus"
// FORK: 选区菜单贴边沿溢出修复(REQ-032)— 渲染后 measure + clamp 进视口
import { repositionMenu } from "@/utils/menu-position"
import { isImeComposingEvent } from "@/utils/ime"
// FORK: Ctrl+C v2 — onSelChange scope 闸 + keydown 当前选区优先决策
// 修跨区域选区污染 + history 策略错配两 bug,详见 file-tabs-ctrl-c.ts 头部注释 2026-05-29
import { decideCtrlCAction } from "./file-tabs-ctrl-c"
// FORK: 选区历史 + 单例 bus 抽出 module(2026-05-29 refactor):
// - selection-history.ts:`ViewerSelectionHistory` + `readSelectionWithShadows`(从 file-tabs.tsx 挪出)
// - selection-bus.ts:`registerViewer` 单例 document.selectionchange,消除 N×listener
// history 现在只剩**一个**合法消费者(`handleSelectionContextMenu` 对抗 macOS WebKit shadow collapse bug)
import { registerViewer } from "./selection-bus"
import type { ViewerSelectionHistory } from "./selection-history"

function isMarkdownPath(p: string | undefined): boolean {
  if (!p) return false
  const lower = p.toLowerCase()
  return lower.endsWith(".md") || lower.endsWith(".markdown")
}

// FORK: HTML 预览支持 2026-05-05
function isHtmlPath(p: string | undefined): boolean {
  if (!p) return false
  const lower = p.toLowerCase()
  return lower.endsWith(".html") || lower.endsWith(".htm")
}

// FORK: CSV/TSV 表格视图 [feat: csv-table-viewer] 2026-06-14
function isCsvPath(p: string | undefined): boolean {
  if (!p) return false
  const lower = p.toLowerCase()
  return lower.endsWith(".csv") || lower.endsWith(".tsv")
}

// HTML 预览大文件阈值 — 对齐 file-limits.ts MAX_EDITABLE_BYTES(预览与编辑同卡 10MB)
// FORK: 2026-05-14 2MB → 10MB,user 反馈大 PPT / Slides 常见 >2MB,旧阈值过保守
const HTML_PREVIEW_MAX_BYTES = 10 * 1024 * 1024

// 文件路径父目录(forward slash;支持 Windows 反斜杠)
function pathDirname(p: string): string {
  const fwd = p.replace(/\\/g, "/")
  const idx = fwd.lastIndexOf("/")
  return idx >= 0 ? fwd.slice(0, idx) : ""
}

// In-memory LRU cache for fetched office PDF binaries. Saves having to re-fetch
// 200+ MB across tab switches. Bounded so RAM doesn't grow unboundedly.
const OFFICE_PDF_CACHE_MAX = 2
const officePdfCache = new Map<string, Uint8Array>()
function officePdfCacheGet(key: string): Uint8Array | undefined {
  const value = officePdfCache.get(key)
  if (value) {
    officePdfCache.delete(key)
    officePdfCache.set(key, value) // bump to most-recent
  }
  return value
}
function officePdfCacheSet(key: string, value: Uint8Array) {
  if (officePdfCache.has(key)) officePdfCache.delete(key)
  officePdfCache.set(key, value)
  while (officePdfCache.size > OFFICE_PDF_CACHE_MAX) {
    const oldest = officePdfCache.keys().next().value
    if (oldest === undefined) break
    officePdfCache.delete(oldest)
  }
}

// audio 元素分支:纯音频容器
const AUDIO_MIME_FALLBACKS: Record<string, string[]> = {
  ".mp3": ["audio/mpeg"],
  ".m4a": ["audio/mp4", "audio/x-m4a", "audio/aac"],
  ".wav": ["audio/wav", "audio/wave", "audio/x-wav"],
  ".ogg": ["audio/ogg"],
  ".aac": ["audio/aac", "audio/mp4"],
  ".flac": ["audio/flac", "audio/x-flac"],
  ".opus": ["audio/opus", "audio/ogg"],
}

// video 元素分支
const VIDEO_MIME_FALLBACKS: Record<string, string[]> = {
  ".mp4": ["video/mp4"],
  ".m4v": ["video/mp4"],
  ".mov": ["video/quicktime", "video/mp4"],
  ".webm": ["video/webm"],
  ".mkv": ["video/x-matroska", "video/mp4"],
  ".avi": ["video/x-msvideo", "video/avi"],
}

// FORK: 图片预览 — 走 localasset 不进 JS 内存,同时修原"图片不可预览"缺位
// [feat: large-file-preview-guard] 2026-05-21
const IMAGE_MIME_FALLBACKS: Record<string, string[]> = {
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".gif": ["image/gif"],
  ".webp": ["image/webp"],
  ".bmp": ["image/bmp"],
  ".svg": ["image/svg+xml"],
  ".ico": ["image/x-icon"],
}

// WebView2 内置播放器解不出的扩展(实测:audio 元素和 video 元素都失败)。直接走"用系统播放器打开"兜底,跳过 base64 加载。
const UNSUPPORTED_MEDIA_EXTS = new Set([".m4a"])

function isUnsupportedMedia(p: string | undefined): boolean {
  if (!p) return false
  const lower = p.toLowerCase()
  for (const ext of UNSUPPORTED_MEDIA_EXTS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

// FORK: image kind 加入,统一走 localasset 渲染 [feat: large-file-preview-guard] 2026-05-21
type MediaKind = "audio" | "video" | "image"

function mediaKindFromPath(p: string | undefined): { kind: MediaKind; mimes: string[] } | null {
  if (!p) return null
  const lower = p.toLowerCase()
  for (const ext in VIDEO_MIME_FALLBACKS) {
    if (lower.endsWith(ext)) return { kind: "video", mimes: VIDEO_MIME_FALLBACKS[ext] }
  }
  for (const ext in AUDIO_MIME_FALLBACKS) {
    if (lower.endsWith(ext)) return { kind: "audio", mimes: AUDIO_MIME_FALLBACKS[ext] }
  }
  for (const ext in IMAGE_MIME_FALLBACKS) {
    if (lower.endsWith(ext)) return { kind: "image", mimes: IMAGE_MIME_FALLBACKS[ext] }
  }
  return null
}

// FORK: pdf-like 检测(PDF + Office) — ContextMenuHost data-slot 条件性 wrap 用
// 用 wrapper 替代直接改 packages/ui/.../pdf.tsx(后者在 R4 黑名单)。等价效果。
// [feat: office-选中加聊天] 2026-05-24
function isPdfLikePath(p: string | undefined): boolean {
  if (!p) return false
  return p.toLowerCase().endsWith(".pdf") || isOfficeDocument(p)
}

function rangeAt(source: string, offset: number, len: number) {
  const before = source.slice(0, offset)
  const inner = source.slice(offset, offset + len)
  const start = (before.match(/\n/g)?.length ?? 0) + 1
  const end = start + (inner.match(/\n/g)?.length ?? 0)
  return { start, end }
}

// 构建归一化空白后的字符串 + 原 offset 映射,用于宽松匹配。
function normalizeWithMap(s: string): { text: string; back: number[] } {
  const back: number[] = []
  let out = ""
  let prevSpace = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      if (!prevSpace && out.length > 0) {
        out += " "
        back.push(i)
      }
      prevSpace = true
    } else {
      out += c
      back.push(i)
      prevSpace = false
    }
  }
  return { text: out, back }
}

// 把选中文字映射回源码行号区间(1-based)。
// 1. 精确 indexOf;2. 归一化空白后再 indexOf(应对跨行选中的表格/列表,DOM text 中空白被压缩)。
// 都失败 → null,调用方走无 selection 分支(commentID 兜底去重)。
function findLineRange(source: string, needle: string): { start: number; end: number } | null {
  if (!source || !needle) return null
  const trimmed = needle.trim()
  if (!trimmed) return null

  const idx = source.indexOf(trimmed)
  if (idx >= 0) return rangeAt(source, idx, trimmed.length)

  const { text: nSource, back } = normalizeWithMap(source)
  const nNeedle = trimmed.replace(/[\s]+/g, " ")
  const nIdx = nSource.indexOf(nNeedle)
  if (nIdx < 0 || nIdx >= back.length) return null

  const srcStart = back[nIdx]
  const endNIdx = Math.min(nIdx + nNeedle.length, back.length - 1)
  const srcEnd = back[endNIdx] ?? source.length
  return rangeAt(source, srcStart, Math.max(1, srcEnd - srcStart))
}

function truncatePreview(text: string, max = 500): string {
  const collapsed = text.replace(/\s+/g, " ").trim()
  if (collapsed.length <= max) return collapsed
  return collapsed.slice(0, max) + "…"
}

function FileCommentMenu(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          size="small"
          class="size-6 rounded-md"
          aria-label={props.moreLabel}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={props.onEdit}>
              <DropdownMenu.ItemLabel>{props.editLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={props.onDelete}>
              <DropdownMenu.ItemLabel>{props.deleteLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}

type ScrollPos = { x: number; y: number }

function createScrollSync(input: { tab: () => string; view: ReturnType<typeof useSessionLayout>["view"] }) {
  let scroll: HTMLDivElement | undefined
  let scrollFrame: number | undefined
  let restoreFrame: number | undefined
  let pending: ScrollPos | undefined
  const [code, setCode] = createSignal<HTMLElement[]>([])

  const getCode = () => {
    const el = scroll
    if (!el) return []

    const host = el.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot
    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const save = (next: ScrollPos) => {
    pending = next
    if (scrollFrame !== undefined) return

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined

      const out = pending
      pending = undefined
      if (!out) return

      input.view().setScroll(input.tab(), out)
    })
  }

  const onCodeScroll = (event: Event) => {
    const el = scroll
    if (!el) return

    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return

    save({
      x: target.scrollLeft,
      y: el.scrollTop,
    })
  }

  const sync = () => {
    const next = getCode()
    const current = code()
    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = scroll
    if (!el) return

    const pos = input.view().scroll(input.tab())
    if (!pos) return

    sync()

    if (code().length > 0) {
      for (const item of code()) {
        if (item.scrollLeft !== pos.x) item.scrollLeft = pos.x
      }
    }

    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    if (code().length > 0) return
    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const queueRestore = () => {
    if (restoreFrame !== undefined) return

    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = undefined
      restore()
    })
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (code().length === 0) sync()

    save({
      x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    })
  }

  createEffect(() => {
    for (const item of code()) makeEventListener(item, "scroll", onCodeScroll)
  })

  const setViewport = (el: HTMLDivElement) => {
    scroll = el
    restore()
  }

  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
  })

  return {
    handleScroll,
    queueRestore,
    setViewport,
  }
}

export function FileTabContent(props: {
  tab: string
  // FORK: MD 内链跳转 [link](./other.md) — 点击在文件查看器打开目标 2026-05-05
  onOpenTab?: (path: string) => void
}) {
  const file = useFile()
  const sdk = useSDK()
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  // FORK: .md 导出 PDF / Word — 走 platform.saveFilePickerDialog [feat: md-export-pdf-word] 2026-05-05
  const platform = usePlatform()
  const fileComponent = useFileComponent()
  const { sessionKey, tabs, view } = useSessionLayout()
  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  }).activeFileTab

  let find: FileSearchHandle | null = null

  const search = {
    register: (handle: FileSearchHandle | null) => {
      find = handle
    },
  }

  const path = createMemo(() => file.pathFromTab(props.tab))
  const state = createMemo(() => {
    const p = path()
    if (!p) return
    return file.get(p)
  })
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))

  // === editable viewer state (Phase 2 editable file viewer + Phase 3 guardrails) ===
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal<string | null>(null)
  const [loadedMtime, setLoadedMtime] = createSignal<number | null>(null)
  // FORK: md-editing-iter-2 — 编辑器光标 / 选区状态(行/列/选中字符数)2026-05-09
  const [cursorInfo, setCursorInfo] = createSignal<CursorInfo | undefined>(undefined)
  const dirty = createMemo(() => {
    const d = draft()
    return d !== null && d !== contents()
  })
  // FORK: REQ-074 换基座回归修复 — isTauri()(检测 __TAURI_INTERNALS__)在 Electron 永远 false,
  // 编辑按钮永久灰显;改走 native.ts isDesktopApp()(检测 window.deskfox 桥)[feat: batch-port-edit-mdlink] 2026-07-07
  const canEdit = () => {
    if (!isDesktopApp()) return false
    const p = path()
    if (!p) return false
    if (isBinary(p)) return false
    if (isOfficeDocument(p)) return false
    // FORK: 大文件预览统一防护 — tooLarge 文件 contents 已空,必须用 state.tooLarge 短路防止编辑空内容覆盖真实文件
    // [feat: large-file-preview-guard] 2026-05-21
    if (state()?.tooLarge) return false
    if (tooLarge(contents())) return false
    return true
  }
  const editDisabledReason = () => {
    // FORK: 禁编辑提示走 i18n(原为硬编码中英混杂,英文 locale 看到中文)[feat: ui-brand-deskfox] 2026-06-06
    if (!isDesktopApp()) return language.t("fileViewer.editDisabled.desktopOnly")
    const p = path()
    if (!p) return undefined
    if (isOfficeDocument(p)) return language.t("fileViewer.editDisabled.office")
    if (isBinary(p)) return language.t("fileViewer.editDisabled.binary")
    // FORK: 大文件预览统一防护 [feat: large-file-preview-guard] 2026-05-21
    if (state()?.tooLarge) return language.t("fileViewer.editDisabled.tooLarge")
    if (tooLarge(contents())) return language.t("fileViewer.editDisabled.tooLarge")
    return undefined
  }
  const startEdit = async () => {
    const p = path()
    const root = sdk().directory
    if (!p || !root) return
    try {
      const mtime = await invoke<number>("get_file_mtime", { root, path: p })
      setLoadedMtime(mtime)
    } catch (e) {
      // 拿不到 mtime(文件可能不存在、权限问题)→ mtime 检测跳过(传 null)
      setLoadedMtime(null)
      console.warn("get_file_mtime failed, skipping mtime check:", e)
    }
    setDraft(contents())
    setEditing(true)
  }
  const cancelEdit = () => {
    setEditing(false)
    setDraft(null)
    setLoadedMtime(null)
  }
  const performWrite = async (root: string, p: string, content: string, expectedMtime: number | null) => {
    await invoke("write_text_file", { root, path: p, content, expectedMtime })
  }
  const reloadAndExitEdit = async (p: string) => {
    setEditing(false)
    setDraft(null)
    setLoadedMtime(null)
    await file.load(p, { force: true })
  }
  // FORK: saveEdit 重构为 saveEditCore({ silent }) — auto-save 用 silent 路径:
  //   - silent=true(auto-save):成功不 toast,失败仍 toast;mtime 冲突不弹 confirm
  //     (保持 editing 让 user 主动 save 时再走 confirm 流程,避免 auto-save 突然弹窗);
  //     成功后不 reloadAndExitEdit(user 还在编辑,只更新 loadedMtime 让下次 save 也能 mtime 检测)
  //   - silent=false(主动 Save 按钮):原行为不变(toast + reloadAndExitEdit + confirm)
  // [feat: auto-save-debounce-flush] 2026-05-21
  const saveEditCore = async (opts: { silent: boolean }) => {
    const p = path()
    const root = sdk().directory
    if (!p || !root || draft() === null) return
    try {
      // FORK: 标记 self-writing 短期窗口,防 watcher 误识别为外部 AI 修改弹 toast
      // [feat: auto-save-debounce-flush] 2026-05-21
      if (opts.silent) file.markSelfWriting(p)
      await performWrite(root, p, draft() ?? "", loadedMtime())
      // FORK: 保存成功后清掉残留的 dirtyConflict toast(修"保存后双提示框"bug)2026-05-05
      file.dismissDirtyConflict(p)
      if (opts.silent) {
        // auto-save:保持 editing,更新 loadedMtime 让下次 save 也能用 mtime 检测
        try {
          const newMtime = await invoke<number>("get_file_mtime", { root, path: p })
          setLoadedMtime(newMtime)
        } catch {
          setLoadedMtime(null)
        }
      } else {
        // 主动 Save:退编辑 + reload contents
        await reloadAndExitEdit(p)
        showToast({ variant: "success", title: "Saved" })
      }
    } catch (e) {
      const msg = String(e)
      if (msg.includes("mtime_conflict")) {
        if (opts.silent) {
          // FORK: auto-save 遇外部修改不弹 confirm,toast warning 让 user 主动 save 再处理
          // [feat: auto-save-debounce-flush] 2026-05-21
          showToast({
            variant: "error",
            title: "自动保存暂停 — 文件已被外部修改",
            description: "请手动点 Save 选择覆盖或重载磁盘版本",
          })
          return
        }
        const overwrite = window.confirm(
          "⚠ 磁盘上的这个文件已被其他程序修改(可能是 AI 或外部编辑器)。\n\n" +
            "[确定] 覆盖磁盘版本,保存我的改动\n" +
            "[取消] 丢弃我的改动,重新加载磁盘版本",
        )
        if (overwrite) {
          try {
            await performWrite(root, p, draft() ?? "", null)
            await reloadAndExitEdit(p)
            file.dismissDirtyConflict(p)
            showToast({ variant: "success", title: "Overwritten" })
          } catch (e2) {
            showToast({ variant: "error", title: `Overwrite failed: ${e2}` })
          }
        } else {
          await reloadAndExitEdit(p)
          file.dismissDirtyConflict(p)
          showToast({ variant: "success", title: "Reloaded from disk" })
        }
      } else if (msg.includes("readonly:")) {
        showToast({ variant: "error", title: "File is read-only, cannot save" })
      } else {
        showToast({ variant: "error", title: `Save failed: ${e}` })
      }
    }
  }
  const saveEdit = () => saveEditCore({ silent: false })

  // FORK: debounce auto-save — editing 中 draft 变化 1s 静默后自动落盘
  // [feat: auto-save-debounce-flush] 2026-05-21
  const AUTO_SAVE_DELAY_MS = 1000
  const autoSave = createDebounced(() => saveEditCore({ silent: true }), AUTO_SAVE_DELAY_MS)

  // draft 改动 + editing + dirty → trigger debounce(1s 后没新改动则 save)
  createEffect(() => {
    draft()
    if (editing() && dirty()) {
      autoSave.trigger()
    }
  })

  // editing 退出取消挂起的 autoSave(cancelEdit / saveEditCore 退编辑 / tab 切换 都会 cover)
  createEffect(
    on(editing, (now) => {
      if (!now) autoSave.cancel()
    }),
  )

  // FORK: unmount 时 flush dirty draft + cancel debounce(切 tab 真触发点)
  //   关键发现:`<Show when={activeFileTab()} keyed>`(session-side-panel.tsx)切 tab 时
  //   整个 FileTabContent unmount + remount,path signal 不会"变化",createEffect(on(path))
  //   永不 fire。flush 必须放 onCleanup,unmount 前 signal 仍可读,setStoredContent 经
  //   父级 file context 安全生效(下次 mount 看新 store 内容)。
  //   [feat: auto-save-debounce-flush] 2026-05-22
  onCleanup(() => {
    autoSave.cancel()
    const oldPath = path()
    if (editing() && dirty() && oldPath && sdk().directory) {
      const snap = draft() ?? ""
      const mtime = loadedMtime()
      const root = sdk().directory
      void (async () => {
        try {
          file.markSelfWriting(oldPath)
          await performWrite(root, oldPath, snap, mtime)
          file.dismissDirtyConflict(oldPath)
          file.setStoredContent(oldPath, snap)
        } catch (e) {
          const msg = String(e)
          if (msg.includes("mtime_conflict")) {
            showToast({
              variant: "error",
              title: "切 tab 时自动保存失败 — 文件已被外部修改",
              description: `${oldPath} 改动已丢失,原文件未变(磁盘上是外部最新版本)`,
            })
          } else if (msg.includes("readonly:")) {
            showToast({ variant: "error", title: `${oldPath} 是只读文件,自动保存失败` })
          } else {
            showToast({ variant: "error", title: `${oldPath} 自动保存失败:${e}` })
          }
        }
      })()
    }
  })

  // FORK: window close flush — 关闭到托盘前 silent save 未保存改动
  // [feat: auto-save-debounce-flush] 2026-05-21
  // [feat: electron-replatform] 2026-06-12 — Electron 主进程 close 时直接 emit deskfox-flush-before-close,
  //   本组件直连 native.listen(不再依赖 layout 把它转成 DOM 事件);DOM 事件路径保留向后兼容。
  onMount(() => {
    const handler = () => {
      if (editing() && dirty()) {
        autoSave.flush()
      }
    }
    window.addEventListener("deskfox-flush-now", handler)
    let unlisten: (() => void) | undefined
    // FORK: 2026-08-11 — 浏览器/e2e 环境无 preload 桥,native.listen 同步 throw 会炸全屏
    //   ErrorBoundary(上游 v1.18.4 v2 review e2e 首次在浏览器 mount 本组件暴露);桥不在时
    //   仅走 DOM 事件路径(deskfox-flush-now)兜底
    if (isDesktopApp()) void listen("deskfox-flush-before-close", handler).then((u) => (unlisten = u))
    onCleanup(() => {
      window.removeEventListener("deskfox-flush-now", handler)
      unlisten?.()
    })
  })
  // FORK: dirty 状态同步给 file context,让 watcher reload 守卫(查看器-自动刷新)2026-04-28
  createEffect(
    on(
      () => ({ p: path(), d: dirty() }),
      (curr, prev) => {
        if (prev?.p && prev.p !== curr.p) {
          file.markDirty(prev.p, false)
        }
        if (curr.p) file.markDirty(curr.p, curr.d)
      },
    ),
  )
  onCleanup(() => {
    const p = path()
    if (p) file.markDirty(p, false)
  })
  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    const p = path()
    if (!p) return null
    if (file.ready()) return (file.selectedLines(p) as SelectedLineRange | undefined) ?? null
    return (getSessionHandoff(sessionKey())?.files[p] as SelectedLineRange | undefined) ?? null
  })
  const scrollSync = createScrollSync({
    tab: () => props.tab,
    view,
  })

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
  }

  const buildPreview = (filePath: string, selection: FileSelection) => {
    const source = filePath === path() ? contents() : file.get(filePath)?.content?.content
    if (!source) return undefined
    return selectionPreview(source, selection)
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    // FORK: quote 特性已从 Tauri 迁回(原 deferred TODO 完成)[feat: 聊天选区-卡片化-换行] 2026-06-14
    origin?: "review" | "file" | "quote"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, selection)

    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    const preview = input.file === path() ? buildPreview(input.file, selectionFromLines(input.selection)) : undefined
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(preview ? { preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const fileComments = createMemo(() => {
    const p = path()
    if (!p) return []
    return comments.list(p)
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore({
    openedComment: null as string | null,
    commenting: null as SelectedLineRange | null,
    selected: null as SelectedLineRange | null,
  })

  const syncSelected = (range: SelectedLineRange | null) => {
    const p = path()
    if (!p) return
    file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
  }

  const activeSelection = () => note.selected ?? selectedLines()

  const commentsUi = createLineCommentController({
    comments: fileComments,
    label: language.t("ui.lineComment.submit"),
    draftKey: () => path() ?? props.tab,
    mention: {
      items: file.searchFilesAndDirectories,
    },
    state: {
      opened: () => note.openedComment,
      setOpened: (id) => setNote("openedComment", id),
      selected: () => note.selected,
      setSelected: (range) => setNote("selected", range),
      commenting: () => note.commenting,
      setCommenting: (range) => setNote("commenting", range),
      syncSelected,
      hoverSelected: syncSelected,
    },
    getHoverSelectedRange: activeSelection,
    cancelDraftOnCommentToggle: true,
    clearSelectionOnSelectionEndNull: true,
    onSubmit: ({ comment, selection }) => {
      const p = path()
      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onUpdate: ({ id, comment, selection }) => {
      const p = path()
      if (!p) return
      updateCommentInContext({ id, file: p, selection, comment })
    },
    onDelete: (comment) => {
      const p = path()
      if (!p) return
      removeCommentFromContext({ id: comment.id, file: p })
    },
    editSubmitLabel: language.t("common.save"),
    renderCommentActions: (_, controls) => (
      <FileCommentMenu
        moreLabel={language.t("common.moreOptions")}
        editLabel={language.t("common.edit")}
        deleteLabel={language.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeFileTab() !== props.tab) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "f") return
      // FORK: 编辑态聚焦 CodeMirror 时让编辑器自己收 Ctrl+F(@codemirror/search 面板)2026-05-05
      const active = document.activeElement as HTMLElement | null
      if (active?.closest(".cm-editor")) return

      event.preventDefault()
      event.stopPropagation()
      find?.focus()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  // FORK: md-editing-iter-3 矫正 ⑦ — Cmd+Shift+E 进编辑模式 keybind
  // 起源:Tauri WKWebView + SolidJS Portal 互操作,合成 click 事件(cliclick/osascript/
  //      CGEventPost)打不到右键菜单内 button,导致 GUI 自动化测试无法触发"编辑"按钮。
  //      加键盘快捷键给 user 便利 + 让 e2e 测试能键盘驱动。2026-05-25
  createEffect(() => {
    if (typeof window === "undefined") return
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeFileTab() !== props.tab) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || !event.shiftKey) return
      if (event.key.toLowerCase() !== "e") return
      if (editing()) return // 已在编辑模式
      if (!canEdit() || !state()?.loaded) return
      event.preventDefault()
      event.stopPropagation()
      void startEdit()
    }
    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  // FORK-BEGIN: 文件查看器 Ctrl/Cmd+C — 修非 .md 内容(@pierre/diffs shadow DOM)原生 Ctrl+C 拿不到选区的 bug 2026-05-04
  // 现象:.md 走 light DOM 原生 Ctrl+C 工作;代码 / HTML / PDF / office 预览走 <diffs-container> shadow DOM,
  // window.getSelection().toString() 对 shadow 内容返回空 → 系统剪贴板拿不到东西 → "Ctrl+C 没反应"。
  //
  // v1(2026-05-04):pickBestRecentSelection() history "最近最长" 策略统一兜底,preventDefault 阻断原生。
  // v2(2026-05-29):v1 引入两个新 bug — A) viewer 内重选短覆盖长 / B) 跨区域污染 / C) 取消选区后幽灵复制,
  //   见 OPENCODE-PLAN/需求池/ctrl-c-复制失效.md。
  //   R2 改用 readSelectionText 拿**当前**选区(shadow-aware,无右键 collapse bug),交 decideCtrlCAction 决策:
  //     · 无选区 → noop(让原生 no-op,解 C)
  //     · anchor 不在本 viewer → noop(让 chat 区 / 其他 tab 走自己的原生,解 B)
  //     · viewer 内 + light DOM → native(直接让原生 Ctrl+C 处理 — 比 history 更准确,解 A 的 light 半边)
  //     · viewer 内 + shadow DOM → shadow-intercept,handler 自己 writeText(原生看不到 shadow,解 A 的 shadow 半边)
  //   history(selectionHistory + pickBestRecentSelection)保留给右键 contextmenu 用,kbd 路径不再走。
  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeFileTab() !== props.tab) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "c") return
      if (editing()) return // CodeMirror 编辑态自己管 Ctrl+C

      // 焦点在可编辑元素 → 让原生处理(input/textarea 自有 selection,不走 history)
      const ae = document.activeElement as HTMLElement | null
      if (ae && (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || ae.isContentEditable)) return

      const sel = window.getSelection()
      if (!sel || !viewerHistory) return
      const result = viewerHistory.readSelection(sel)
      const decision = decideCtrlCAction({
        text: result.text,
        shadow: result.shadow,
        anchorNode: sel.anchorNode,
        viewerRoot: viewerRootRef,
      })

      if (decision.action === "shadow-intercept") {
        event.preventDefault()
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          navigator.clipboard.writeText(decision.text).catch(() => {})
        }
      }
      // "noop" / "native" → 不 preventDefault,让浏览器原生 Ctrl+C 自处理(或 no-op)
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })
  // FORK-END

  createEffect(
    on(
      path,
      () => {
        commentsUi.note.reset()
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const focus = comments.focus()
    const p = path()
    if (!focus || !p) return
    if (focus.file !== p) return
    if (activeFileTab() !== props.tab) return

    const target = fileComments().find((comment) => comment.id === focus.id)
    if (!target) return

    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
    requestAnimationFrame(() => comments.clearFocus())
  })

  let prev = {
    loaded: false,
    ready: false,
    active: false,
  }

  createEffect(() => {
    const loaded = !!state()?.loaded
    const ready = file.ready()
    const active = activeFileTab() === props.tab
    const restore = (loaded && !prev.loaded) || (ready && !prev.ready) || (active && loaded && !prev.active)
    prev = { loaded, ready, active }
    if (!restore) return
    scrollSync.queueRestore()
  })

  // 右键选中文字弹自定义菜单(2 项:复制 / + 添加到聊天窗口)
  // 点 "+ 添加到聊天窗口" 切到输入面板,用户写问题/修改意见,提交后选中文字 + 评论一起加进聊天上下文
  type MdMenuMode = "menu" | "input"
  type MdMenuState = { open: boolean; x: number; y: number; text: string; mode: MdMenuMode }
  const [mdMenu, setMdMenu] = createSignal<MdMenuState>({ open: false, x: 0, y: 0, text: "", mode: "menu" })

  // FORK: 菜单视口边界保护(REQ-032)— 同 host.tsx ContextMenuHost 的同款模式,初帧 visibility:hidden,
  // 渲染后 measure + clamp 进视口再可见。不能用常量宽高(input 卡 360px + textarea 多行高,差异大)。
  // [feat: req-032-menu-clamp-viewport] 2026-05-28
  let mdMenuEl: HTMLDivElement | undefined
  // FORK: Ctrl+C v2 + selection-bus — 实例 scope 的 viewer 根节点 ref。2026-05-29
  // - selection-bus 用它做 selectionchange 路由(只有 anchor 在本 viewer 内的选区入本实例 history)
  // - Ctrl+C handler 用它判 anchor 是否在本 tab 内,跨 tab + 跨区域选区互不污染
  let viewerRootRef: HTMLElement | undefined
  // FORK: 本 FileTabContent 实例的选区历史(由 selection-bus 注册时分配)2026-05-29
  // 唯一消费者:`handleSelectionContextMenu` 对抗 macOS WebKit shadow DOM 右键 collapse bug
  let viewerHistory: ViewerSelectionHistory | undefined
  createEffect(() => {
    const m = mdMenu()
    if (!m.open) return
    queueMicrotask(() => {
      if (mdMenuEl) repositionMenu(mdMenuEl, m.x, m.y)
    })
  })
  // FORK: input mode textarea focus — REQ-032 visibility:hidden + el.focus() race 修复 2026-05-29
  // 起源:REQ-032(2026-05-28 commit d944cabb4)给菜单 div 加初帧 `visibility: hidden` + repositionMenu
  // microtask 才置 visible(防闪)。textarea 自带 `ref={(el) => queueMicrotask(() => el.focus())}` 比
  // repositionMenu microtask **早一拍**触发(JSX mount 在 createEffect 之前 schedule),浏览器对
  // visibility:hidden 元素的 `.focus()` 是 **silent fail**(Chromium 与 WebKit 行为一致)→
  // 焦点回落到上一个有焦点的元素(典型场景:上次 submitMdSelection 后 focusChatInput 留在底部主聊天框)。
  // 修法:把 focus 从 textarea ref 抽到本 createEffect,用 requestAnimationFrame —— 比所有 queueMicrotask
  // 都晚一拍,等 repositionMenu 已设 visibility:visible 之后再 focus,可靠。
  createEffect(() => {
    const m = mdMenu()
    if (!m.open || m.mode !== "input") return
    requestAnimationFrame(() => {
      if (!mdMenuEl) return
      const ta = mdMenuEl.querySelector("textarea") as HTMLTextAreaElement | null
      ta?.focus()
    })
  })
  const [mdComment, setMdComment] = createSignal("")

  // 选区红色覆盖层:绝对定位的 div 数组,通过 range.getClientRects() 计算每行 rect。
  //
  // 之前用 CSS Custom Highlight API(::highlight pseudo + CSS.highlights 注册表)实测在
  // macOS WKWebView 上 delete 注册项**不能立即触发 repaint**(WebKit 的 stale 渲染 bug),
  // 即便先 set 一个 collapsed 空 range 兜底也压不住 —— 用户点"加入聊天"或点空白处关菜单后,
  // 红色高亮死活不消失,只能刷新页面才清。
  //
  // 改用 overlay div 方案:
  //   - 显示:range.getClientRects() 拿每行 viewport rect → 渲染 fixed 定位的红色 div
  //   - 清除:setHighlightRects(null) → Solid 信号驱动 unmount,WebKit 没机会缓存
  //   - 滚动:绑 scroll capture 监听,滚动时直接清(用户在菜单生命周期内极少滚)
  //
  // 颜色:GitHub 蓝 rgba(56,139,253,0.4) —— 与原生 ::selection(index.css 统一蓝)同系,
  //   拖选(原生蓝)↔ 右键(overlay 蓝)视觉无缝。md / 代码 / PDF / CSV / HTML iframe 都走此 overlay,统一一致。
  //   [feat: viewer-selection-tray-style] 2026-06-14(原 Microsoft Fluent 红 #d13438,user 反馈各格式不统一)
  type HighlightRect = { left: number; top: number; width: number; height: number }
  const [highlightRects, setHighlightRects] = createSignal<HighlightRect[] | null>(null)

  // clipRect:把高亮矩形裁到容器边界(CSV grid 选区会横跨整行/横向滚出可视区,overlay fixed 定位会
  // 溢出到文件树/聊天 → 传 CSV 容器矩形裁剪)。其余格式不传,行为不变。[feat: viewer-selection-tray-style]
  const setSelectionHighlight = (range: Range | null, clipRect?: DOMRect | null) => {
    if (!range) {
      setHighlightRects(null)
      return
    }
    try {
      const raw = Array.from(range.getClientRects())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }))
      const rects = clipRect ? clampRectsToBounds(raw, clipRect) : raw
      setHighlightRects(rects.length > 0 ? rects : null)
    } catch {
      setHighlightRects(null)
    }
  }

  // 滚动时清掉(viewport rect 会失效);菜单生命周期短,滚动概率低
  createEffect(() => {
    if (!highlightRects()) return
    const onScroll = () => setHighlightRects(null)
    window.addEventListener("scroll", onScroll, true)
    onCleanup(() => window.removeEventListener("scroll", onScroll, true))
  })

  const closeMdMenu = () => {
    setMdMenu((m) => (m.open ? { ...m, open: false } : m))
    setMdComment("")
    setSelectionHighlight(null)
    // 关闭右键菜单时一并清掉:① 原生 window selection(字符级蓝/黄高亮)
    // ② Pierre 的 selectedLines(整行黄色色块)。无论用户是"加入聊天"还是"取消",
    // 选区视觉都同步消失,菜单关闭后页面回到无选区干净态。
    if (typeof window !== "undefined") {
      try {
        window.getSelection()?.removeAllRanges()
      } catch {
        // ignore
      }
    }
    setNote("selected", null)
    const p = path()
    if (p) file.setSelectedLines(p, null)
  }

  // FORK-BEGIN: 选区历史 — 注册到单例 selection-bus(2026-05-29 refactor)
  //
  // 原版 ~125 行(SelSnapshot type / selectionHistory 数组 / knownShadows / readSelectionText
  // 三策略 / onSelChange 入栈 / pickBestRecentSelection)已抽出到:
  //   - `./selection-history.ts`(ViewerSelectionHistory 类 + readSelectionWithShadows 三策略)
  //   - `./selection-bus.ts`(单例 document.selectionchange listener,消除 N×listener)
  //
  // 历史机制本质是 macOS WebKit shadow DOM 右键 collapse bug 的解药 — 看 selection-history.ts 头部注释。
  // 现在只剩 `handleSelectionContextMenu`(代码/HTML/PDF/office 等 Pierre shadow 右键)一个消费者用 history;
  // Ctrl+C kbd 路径用 `viewerHistory.readSelection(sel)` 即时读不入栈。
  onMount(() => {
    if (!viewerRootRef) return
    const reg = registerViewer(viewerRootRef)
    viewerHistory = reg.history
    onCleanup(() => {
      reg.destroy()
      viewerHistory = undefined
    })
  })

  // mouse 事件 composedPath + DOM 查询双通道收 ShadowRoot,塞 viewerHistory 的 knownShadows 集
  const handlePreContextCapture = (event: MouseEvent) => {
    viewerHistory?.collectShadowFromEvent(event)
  }
  // FORK-END

  const handleSelectionContextMenu = (event: MouseEvent) => {
    if (editing()) return // 编辑态让 CodeMirror 拿到原生右键菜单
    event.preventDefault()

    // 从 composedPath 找 shadow root 并收集到 viewerHistory.knownShadows
    let shadow: ShadowRoot | null = viewerHistory?.collectShadowFromEvent(event) ?? null

    // 主路径:历史栈里最近 30 秒"文本最长"的条目 → 必为用户多行真实选区
    // (collapse 出的单词肯定更短)。
    let text = ""
    let range: Range | null = null

    const best = viewerHistory?.pickBestRecent() ?? null
    if (best) {
      text = best.text
      range = best.range
      shadow = best.shadow ?? shadow
    } else {
      // 回退:历史完全空(用户首次右键、或刚切换文件)→ 读当前选区
      const sel = typeof window !== "undefined" ? window.getSelection() : null
      if (sel && viewerHistory) {
        const result = viewerHistory.readSelection(sel)
        text = result.text
        range = result.range
        shadow = result.shadow ?? shadow
      }
    }

    if (text.trim() && range) {
      setSelectionHighlight(range)

      // 程序化恢复原生选区:让 OS 绘制的蓝/黄高亮重新覆盖到原始范围。
      // 跨 Shadow DOM 时 addRange 可能静默失败,overlay div 兜底视觉。
      try {
        const sel = typeof window !== "undefined" ? window.getSelection() : null
        if (sel) {
          sel.removeAllRanges()
          sel.addRange(range.cloneRange())
        }
      } catch {
        // ignore — 恢复失败也不影响菜单功能
      }
    }

    setMdComment("")
    setMdMenu({ open: true, x: event.clientX, y: event.clientY, text, mode: "menu" })
  }

  // FORK: light DOM 右键菜单 — 直接读浏览器原生选区,不走历史栈。 2026-05-06
  // 历史栈机制(pickBestRecentSelection)原本只为对抗 Pierre Shadow DOM 在 WebKit 上的
  // selection collapse(右键瞬间选区被 OS 强制 collapse 成单词)。light DOM(.md 自渲染)
  // 上浏览器自己保选区,栈反而引入两个 bug:
  //   ① 选完文字 → 点空白 → 别处右键 → 旧选区从栈里复活,菜单命中旧选区
  //   ② 连选两段 → 别处右键 → 算法挑"最长那条"而非最近,命中第一段不是第二段
  // light DOM 不需要历史栈,直接读 window.getSelection() 即可。
  const handleLightDomContextMenu = (event: MouseEvent) => {
    if (editing()) return
    event.preventDefault()

    let text = ""
    let range: Range | null = null
    const sel = typeof window !== "undefined" ? window.getSelection() : null
    if (sel && sel.rangeCount > 0) {
      const t = sel.toString()
      if (t.trim()) {
        text = t
        range = sel.getRangeAt(0).cloneRange()
      }
    }

    if (text.trim() && range) {
      setSelectionHighlight(range)
    } else {
      setSelectionHighlight(null)
    }

    setMdComment("")
    setMdMenu({ open: true, x: event.clientX, y: event.clientY, text, mode: "menu" })
  }

  const startEditFromMenu = () => {
    closeMdMenu()
    if (canEdit() && state()?.loaded) void startEdit()
  }

  const copyMdSelection = () => {
    const text = mdMenu().text
    if (text && typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {})
    }
    closeMdMenu()
  }

  // FORK-BEGIN: .md 导出 Word [feat: md-export-pdf-word] 2026-05-05
  const onExportDocx = async () => {
    closeMdMenu()
    const p = path()
    const text = contents()
    if (!p || !text) return
    const saveDialog = platform.saveFilePickerDialog
    if (!saveDialog) {
      // 非 desktop 平台 / 平台未实现 — 不应该到这,viewer 只在 desktop 用
      showToast({ variant: "error", title: language.t("fileViewer.toast.exportDocxFail") })
      return
    }
    // 默认文件名 = 原 .md 文件名(去 .md/.markdown 后缀)
    const baseName =
      p.replace(/\\/g, "/").split("/").pop()?.replace(/\.(md|markdown)$/i, "") || "untitled"
    // mdFileDir = .md 文件所在目录绝对路径(同 mdAssetRewriter 计算逻辑),
    // 让 helper 把 ![](./img.png) 等本地图替换为 base64 dataURL 嵌入 docx
    const root = sdk().directory
    const mdFileDir = root && p ? pathDirname(`${root}/${p}`.replace(/\\/g, "/")) : undefined

    await exportMdAsDocx({
      markdownText: text,
      defaultFileName: baseName,
      saveDialog,
      viewerEl: mdContainerRef(),
      mdFileDir,
      i18n: {
        title: language.t("fileViewer.dialog.exportDocxTitle"),
        success: language.t("fileViewer.toast.exportDocxSuccess"),
        fail: language.t("fileViewer.toast.exportDocxFail"),
      },
    })
  }
  // FORK-END

  const openMdInputPanel = () => {
    setMdMenu((m) => ({ ...m, mode: "input" }))
  }

  const submitMdSelection = () => {
    const m = mdMenu()
    const p = path()
    const comment = mdComment().trim()
    closeMdMenu()
    if (!p || !m.text.trim()) return
    const range = findLineRange(contents(), m.text)
    const uid = `md-sel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    prompt.context.add({
      type: "file",
      path: p,
      selection: range ? selectionFromLines(range) : undefined,
      preview: truncatePreview(m.text),
      comment: comment || undefined,
      commentID: uid,
      commentOrigin: "file",
    })
    showToast({ variant: "success", title: comment ? "已加入聊天上下文(含问题)" : "已加入聊天上下文" })
    // FORK: 加 attachment 后把焦点 + 光标交还 chat input,user 可立刻继续打字 [feat: chat-input-focus-follow] 2026-05-21
    // rAF 跟 chat-selection-menu / applyHistoryPrompt 同套路,等 attachment 卡片插入触发的 layout 完再 focus
    requestAnimationFrame(() => {
      focusChatInput()
      // FORK: REQ-082 提交后保持文件预览打开 + 当前文件 active,避免加 context 后布局(尤其窄窗)
      //   把预览收起 —— user 真机反馈「浮窗 Enter 提交后文件预览关闭」。已开则 no-op,安全兜底。2026-07-14
      view().reviewPanel.open()
      tabs().setActive(props.tab)
    })
    // 注:closeMdMenu 已统一处理 removeAllRanges + 清 Pierre 行选区
  }

  createEffect(() => {
    if (!mdMenu().open) return
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest('[data-slot="md-selection-menu"]')) return
      closeMdMenu()
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMdMenu()
    }
    document.addEventListener("mousedown", onDocDown, true)
    document.addEventListener("keydown", onEsc, true)
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocDown, true)
      document.removeEventListener("keydown", onEsc, true)
    })
  })

  // FORK: html-viewer-ux-polish 2026-05-14 — iframe 内事件桥接
  // Rust handler 给 HTML 响应注 capture-phase listener:
  //   - contextmenu: 翻译坐标后弹自家 mdMenu(与 .md 右键体验一致)
  //   - mousedown:   若 mdMenu 当前 open,左键点 iframe 内任意处自动关菜单(对齐 light DOM 的点空白消失行为)
  onMount(() => {
    if (typeof window === "undefined") return
    const handler = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== "object") return
      if ((data as { __deskfox?: unknown }).__deskfox !== true) return
      const t = (data as { type?: unknown }).type
      if (t === "contextmenu") {
        if (!isHtmlPath(path())) return
        const iframe = document.querySelector('iframe[data-html-preview="true"]') as HTMLIFrameElement | null
        if (!iframe) return
        const rect = iframe.getBoundingClientRect()
        const x = rect.left + (Number((data as { x?: unknown }).x) || 0)
        const y = rect.top + (Number((data as { y?: unknown }).y) || 0)
        const txt = (data as { text?: unknown }).text
        const text = typeof txt === "string" ? txt : ""
        // FORK: 把 iframe 内选区 rects(桥接脚本传来,相对 iframe viewport)投影到父文档 → 画 overlay 蓝。
        //   iframe 失焦(父菜单获焦)后浏览器把 iframe 内原生选区渲染成灰,overlay 蓝补偿 → 与其他格式统一。
        //   [feat: viewer-selection-tray-style]
        const rawRects = (data as { rects?: unknown }).rects
        if (Array.isArray(rawRects)) {
          const rects = (rawRects as unknown[])
            .map((r) => r as { left?: unknown; top?: unknown; width?: unknown; height?: unknown })
            .filter(
              (r) =>
                typeof r.left === "number" &&
                typeof r.top === "number" &&
                typeof r.width === "number" &&
                typeof r.height === "number",
            )
            .map((r) => ({ left: r.left as number, top: r.top as number, width: r.width as number, height: r.height as number }))
          setHighlightRects(rects.length > 0 ? projectIframeRects(rects, { left: rect.left, top: rect.top }) : null)
        } else {
          setHighlightRects(null)
        }
        setMdComment("")
        setMdMenu({ open: true, x, y, text, mode: "menu" })
      } else if (t === "mousedown") {
        if (mdMenu().open) closeMdMenu()
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  // FORK: 给 <Markdown> 注入本地资源 src 重写(.md 同目录/相对目录 <img>/<video>/<audio> 走 localasset:// 而非 404)2026-05-05
  // baseDir = 当前 .md 文件所在目录的绝对路径(sdk().directory + dirname(path()));聊天侧不传 rewriteAssetSrc 钩子,无回归
  const mdAssetRewriter = createMemo(() => {
    const root = sdk().directory
    const p = path()
    if (!root || !p) return undefined
    const fileAbs = `${root}/${p}`.replace(/\\/g, "/")
    const baseDir = pathDirname(fileAbs)
    if (!baseDir) return undefined
    return (src: string) => rewriteAssetSrc(root, baseDir, src)
  })

  // FORK: MD 内链点击拦截 — 用容器 ref 监听点击事件(2026-05-05 P0 fix:移除 TOC,user 不要大纲面板)
  const [mdContainerRef, setMdContainerRef] = createSignal<HTMLDivElement | undefined>()

  // MD 内链点击拦截:相对路径 *.md / *.txt / 等 → 调 props.onOpenTab 在查看器打开
  // FORK: REQ-075 — 逻辑提取到 md-link-click.ts 与聊天区共享,此处 baseDir=当前文件所在目录,
  // 行为不变(R1 回归用例守护)[feat: batch-port-edit-mdlink] 2026-07-07
  const handleMdLinkClick = createMdLinkClickHandler({
    root: () => sdk().directory,
    baseDir: () => {
      const root = sdk().directory
      const p = path()
      if (!root || !p) return undefined
      return pathDirname(`${root}/${p}`.replace(/\\/g, "/"))
    },
    onOpen: (rel) => props.onOpenTab?.(rel),
    checkExists: (root, rel) => invoke<number>("get_file_mtime", { root, path: rel }),
    toast: showToast,
  })

  const renderMarkdown = (source: string) => (
    // FORK: data-context scope 让 markdown.css 单独定制文件查看器排版,不影响聊天 2026-04-29
    // FORK: stripFrontmatter — D5 Obsidian 风默认隐藏 YAML 头 2026-05-05
    // FORK: 内链点击拦截 + onClick 容器 — TOC 已移除(user 2026-05-05 反馈不需要)
    <div
      ref={setMdContainerRef}
      data-context="file-viewer"
      class="relative pb-40 px-6 py-4 select-text"
      onContextMenu={handleLightDomContextMenu}
      onClick={handleMdLinkClick}
    >
      <Markdown text={stripFrontmatter(source)} cacheKey={cacheKey()} rewriteAssetSrc={mdAssetRewriter()} />
    </div>
  )

  // FORK: 大文件预览统一防护 L2 — 媒体改走 localasset:// 不进 JS 内存,浏览器原生 HTTP Range
  // 分片读取,1GB+ 视频秒开 + 支持 seek + 内存占用恒定。
  // 不再走 read_binary_file_base64 → base64ToBlob → URL.createObjectURL 链路(OOM 根源)
  // [feat: large-file-preview-guard] 2026-05-21
  const mediaInput = createMemo<{ root: string; path: string; mimes: string[]; kind: MediaKind } | null>(() => {
    const p = path()
    if (!p) return null
    const m = mediaKindFromPath(p)
    if (!m) return null
    const root = sdk().directory
    if (!root) return null
    return { root, path: p, mimes: m.mimes, kind: m.kind }
  })

  type MediaState = {
    url: string | null
    mimes: string[]
    kind: MediaKind | null
    error: string | null
  }
  const [mediaState, setMediaState] = createSignal<MediaState>({
    url: null,
    mimes: [],
    kind: null,
    error: null,
  })

  createEffect(() => {
    const input = mediaInput()
    if (!input) {
      setMediaState({ url: null, mimes: [], kind: null, error: null })
      return
    }
    if (isUnsupportedMedia(input.path)) {
      setMediaState({
        url: null,
        mimes: input.mimes,
        kind: input.kind,
        error: "此格式 WebView2 内置播放器无法解码,请用下方按钮调系统播放器",
      })
      return
    }
    const abs = `${input.root}/${input.path}`.replace(/\\/g, "/")
    setMediaState({
      url: localAssetUrl(input.root, abs),
      mimes: input.mimes,
      kind: input.kind,
      error: null,
    })
  })

  const openMediaInSystemPlayer = async () => {
    const root = sdk().directory
    const p = path()
    if (!root || !p) return
    const absPath = `${root}/${p}`.replace(/\\/g, "/")
    try {
      await invoke("open_path", { path: absPath, appName: null })
    } catch (e) {
      showToast({ variant: "error", title: `打开失败: ${e}` })
    }
  }

  // FORK: img 没有 .error 字段(只有 HTMLMediaElement 有);union 类型容错避免 img onError 时崩
  // [feat: large-file-preview-guard] 2026-05-21
  const onMediaError = (e: { currentTarget: HTMLMediaElement | HTMLImageElement }) => {
    const target = e.currentTarget
    const codeMap: Record<number, string> = {
      1: "ABORTED",
      2: "NETWORK",
      3: "DECODE",
      4: "SRC_NOT_SUPPORTED",
    }
    let detail = "unknown"
    if (target instanceof HTMLMediaElement) {
      const err = target.error
      detail = err
        ? `code=${err.code} (${codeMap[err.code] ?? "UNKNOWN"}) msg="${err.message ?? ""}"`
        : "unknown"
    } else if (target instanceof HTMLImageElement) {
      // img 只能从 naturalWidth/Height 和 complete 推断
      detail = target.complete && target.naturalWidth === 0 ? "无法解码图片" : "加载失败"
    }
    setMediaState((s) => ({ ...s, url: null, error: `解码失败: ${detail}` }))
  }

  const renderMedia = () => (
    <div class="flex flex-col items-center justify-center px-6 py-8 gap-3">
      <Show
        when={mediaState().url}
        fallback={
          <div class="text-text-weak text-sm max-w-xl text-center break-words">
            {mediaState().error ? `加载失败:${mediaState().error}` : "无内容"}
          </div>
        }
      >
        <Switch>
          <Match when={mediaState().kind === "video"}>
            <video
              class="w-full max-w-3xl max-h-[60vh] bg-black"
              controls
              preload="metadata"
              onError={onMediaError}
            >
              <For each={mediaState().mimes}>{(t) => <source src={mediaState().url!} type={t} />}</For>
            </video>
          </Match>
          <Match when={mediaState().kind === "audio"}>
            <audio class="w-full max-w-xl" controls preload="metadata" onError={onMediaError}>
              <For each={mediaState().mimes}>{(t) => <source src={mediaState().url!} type={t} />}</For>
            </audio>
          </Match>
          {/* FORK: 图片预览 — 走 localasset,跟 video/audio 同套路 [feat: large-file-preview-guard] 2026-05-21 */}
          <Match when={mediaState().kind === "image"}>
            <img
              src={mediaState().url!}
              class="max-w-full max-h-[80vh] object-contain"
              alt={path() ?? ""}
              onError={onMediaError}
            />
          </Match>
        </Switch>
      </Show>
      <div class="text-xs text-text-weak truncate max-w-full" title={mediaState().mimes.join(", ")}>
        {path()}
      </div>
      <button
        type="button"
        onClick={openMediaInSystemPlayer}
        class="text-xs px-3 py-1.5 rounded border border-border-base hover:bg-surface-base-hover"
        title="若内置播放器/解码器不支持(WebView2 codec 受限或编码不兼容),点这里用系统默认应用打开"
      >
        用本机软件打开
      </button>
    </div>
  )

  // FORK: 默认渲染路径(@pierre/diffs / fileComponent)— 提取成独立 helper 以便 HTML 源码视图复用 2026-05-05
  //
  // FORK: PDF/office 文件外层加 data-slot="pdf-viewer" wrap,让 ContextMenuHost 识别预览区
  // 接管右键(capture 阶段 preventDefault,mdMenu 走 bubble 不会触发)。
  // wrap 用 display:contents 不影响布局。[feat: office-选中加聊天] 2026-05-24
  const renderDefault = (source: string) => {
    const inner = (
    <div class="relative overflow-hidden pb-40" onMouseDown={handlePreContextCapture} onContextMenu={handleSelectionContextMenu}>
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: source,
          cacheKey: cacheKey(),
        }}
        // FORK: 关闭代码视图的「选中即弹行内评论」[feat: unify-selection-to-chat] 2026-08-13
        //   [bug-repro: user 反馈「TXT 文件选中文字后直接出来了评论框,应该跟其他文件格式看齐 ——
        //    选中文字后点右键加入聊天窗口,统一交互方式」]
        //   分野的来源:走 CodeMirror 的格式(.txt/.json/.toml/.py 及各类代码文件)带行号,
        //   选中行会触发上游的行内评论;而走 DocumentViewer 的格式(.md/.docx/.pdf/图片)
        //   走的是 fork 的「选中 → 右键 → 加入聊天」(handleSelectionContextMenu)。
        //   user 2026-08-13 拍板「后者彻底统一」:代码类文件去掉行内评论,只保留加入聊天。
        //   去掉 enableLineSelection / enableGutterUtility 后,选中不再弹评论框,
        //   右键菜单仍由 handleSelectionContextMenu 接管(非编辑态),两类格式交互一致。
        //   注:审查(review)面板的行评论走 session.tsx 的 onLineComment(origin: "review"),
        //   与本处(origin: "file")是两条路径,不受影响。
        selectedLines={activeSelection()}
        commentedLines={commentedLines()}
        onRendered={() => {
          scrollSync.queueRestore()
        }}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderGutterUtility={commentsUi.renderGutterUtility}
        onLineSelected={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelectionEnd(range)
        }}
        search={search}
        class="select-text"
        media={{
          mode: "auto",
          path: path(),
          current: state()?.content,
          onLoad: scrollSync.queueRestore,
          onError: (args: { kind: "image" | "audio" | "svg" | "pdf" }) => {
            if (args.kind !== "svg") return
            showToast({
              variant: "error",
              title: language.t("toast.file.loadFailed.title"),
            })
          },
          officeTooling: {
            // FORK: office 路由已在后端 HttpApi(/office-tooling/*),SDK 已 regen 生成 office.tooling.* 方法 [feat: electron-replatform]
            
            getStatus: async () =>
              sdk().client.office.tooling
                .status()
                .then((x) => x.data as any)
                .catch(() => undefined),
            startInstall: async () =>
              sdk().client.office.tooling
                .install()
                .then((x) => x.data as any)
                .catch(() => undefined),
            getProgress: async () =>
              sdk().client.office.tooling
                .progress()
                .then((x) => x.data as any)
                .catch(() => undefined),
          },
          onRetryFile: () => {
            const p = path()
            if (p) void file.load(p, { force: true })
          },
          onOpenExternal: () => {
            const root = sdk().directory
            const p = path()
            if (!root || !p) return
            const absPath = `${root}/${p}`.replace(/\\/g, "/")
            invoke("open_path", { path: absPath, appName: null }).catch((e) => {
              showToast({
                variant: "error",
                title: "无法用本机软件打开",
                description: String(e),
              })
            })
          },
          loadOfficePdf: async (filePath: string) => {
            const cacheKey = `${sdk().directory ?? ""}::${filePath}`
            const cached = officePdfCacheGet(cacheKey)
            if (cached) return cached
            try {
              // FORK: /file/office-pdf 路由已在后端,SDK 已 regen 生成 file.officePdf [feat: electron-replatform]
              const res = await sdk().client.file.officePdf(
                { path: filePath },
                { parseAs: "arrayBuffer" } as any,
              )
              const data = (res as any)?.data
              let bytes: Uint8Array | undefined
              if (data instanceof ArrayBuffer) bytes = new Uint8Array(data)
              else if (data instanceof Uint8Array) bytes = data
              else if (data && (data as any).byteLength != null)
                bytes = new Uint8Array(data as ArrayBufferLike)
              if (bytes && bytes.length > 0) {
                officePdfCacheSet(cacheKey, bytes)
              }
              return bytes
            } catch (e) {
              console.warn("loadOfficePdf failed", e)
              return undefined
            }
          },
        }}
      />
    </div>
    )
    if (isPdfLikePath(path())) {
      // FORK: PDF/office 顶栏常驻"用本机软件打开"按钮 — soffice 转的 PDF 是只读栅格化输出,
      // 公式/图表/艺术字光栅化后选不到。给"我就要编辑原始格式"的 user 永久兜底入口。
      //
      // FORK: select-text 必加 — root layout.tsx 全局 `select-none` 只白名单 input/textarea/contenteditable;
      // PDF.js textLayer 的 spans 是普通 <span> 继承 select-none → 文字无法选中。在 wrap 这层
      // 重新启用 user-select:text,CSS 继承传到 .pdf-page-wrapper → .textLayer → span。
      // 跟 message-part.css:709-710 chat 区开 user-select:text 同套路。
      // [feat: office-选中加聊天] 2026-05-24 hot-fix(user 实测 textLayer 选不中复现)
      return (
        <div data-slot="pdf-viewer" data-file-path={path() ?? ""} class="flex flex-col h-full select-text">
          <div class="flex items-center justify-end gap-2 px-3 py-1 border-b border-border-base bg-surface-raised-stronger-non-alpha text-xs">
            <button
              type="button"
              onClick={() => {
                const root = sdk().directory
                const p = path()
                if (!root || !p) return
                const absPath = `${root}/${p}`.replace(/\\/g, "/")
                invoke("open_path", { path: absPath, appName: null }).catch((e) => {
                  showToast({
                    variant: "error",
                    title: "无法用本机软件打开",
                    description: String(e),
                  })
                })
              }}
              class="px-2 py-1 rounded border border-border-base hover:bg-surface-base-hover"
              title="用系统默认应用打开此文件(Word / Excel / PowerPoint / PDF Reader)"
            >
              用本机软件打开
            </button>
          </div>
          <div class="flex-1 min-h-0 overflow-hidden">{inner}</div>
        </div>
      )
    }
    return inner
  }

  // FORK: HTML 预览 — iframe 占满,无顶部 toolbar;右键 → 编辑 进 CodeMirror html 源码模式
  // sandbox: allow-same-origin + allow-scripts(parent 跨 origin,MDN 警告不适用,详 html-viewer-allow-scripts)
  // iframe 内的相对资源(./img.png 等)走 localasset:// 自然解析
  // 大文件(>10MB)走 placeholder(预览 + 编辑同卡,渲染源码也无意义)
  // FORK: 2026-05-14 去顶部 toolbar(预览/源码 toggle 删除)+ 阈值 2MB→10MB + 右键菜单接入 [feat: html-viewer-ux-polish]
  const renderHtml = (source: string) => {
    const root = sdk().directory
    const p = path()
    const sourceLen = source?.length ?? 0
    const tooLargeForPreview = sourceLen > HTML_PREVIEW_MAX_BYTES
    const previewUrl = root && p ? localAssetUrl(root, `${root}/${p}`) : ""

    if (tooLargeForPreview) {
      return (
        <div
          class="relative flex flex-col h-full items-center justify-center px-6 py-8 text-center"
          onContextMenu={handleLightDomContextMenu}
        >
          <div class="text-text-base text-sm">文件 &gt;10MB,不支持预览/编辑</div>
          <div class="text-text-weak text-xs mt-2">请用本机软件打开</div>
        </div>
      )
    }

    return (
      <div class="relative flex flex-col h-full overflow-hidden" onContextMenu={handleLightDomContextMenu}>
        <Show when={previewUrl} fallback={renderDefault(source)}>
          <iframe
            data-html-preview="true"
            src={previewUrl}
            sandbox="allow-same-origin allow-scripts"
            referrerpolicy="no-referrer"
            class="w-full flex-1 bg-white border-0"
            style={{ "min-height": "60vh" }}
          />
        </Show>
      </div>
    )
  }

  // FORK: CSV 右键 —— 复用 md/html 的选区菜单(添加到聊天/复制)。
  //   原先**不画 overlay**(CSS grid 选区 getClientRects 横跨整行 → viewport-fixed overlay 溢出文件树/聊天,
  //   Image#34/#35),只靠 native 选区;但右键 collapse + grid 几何使 native 高亮常消失(user 报"右键底色消失")。
  //   现改为:画 overlay 蓝 + **裁到 CSV 容器矩形**(clampRectsToBounds)防溢出 → 与其他格式统一蓝、不再消失。
  //   [feat: viewer-selection-tray-style] 2026-06-14(原 [feat: csv-table-viewer])
  const handleCsvContextMenu = (event: MouseEvent) => {
    if (editing()) return
    event.preventDefault()
    let text = ""
    let range: Range | null = null
    // FORK: CSV 网格右键点"选区外的表格线"时,Chromium 把原生选区 collapse 成空(原"light DOM 无 collapse"
    //   假设对 CSS grid 不成立,user 报 Image#36/#37)。两步兜底,对齐 Pierre 路径 handleSelectionContextMenu:
    //   ① 用 history.pickBestRecent()(selectionchange 已把选区入栈,免疫右键 collapse)拿回文本+range;
    //   ② 程序化恢复原生选区(sel.addRange)→ 蓝色高亮重新可见,user 不再觉得"失去选区"。
    //   ③ 画 setSelectionHighlight overlay 蓝并**裁到 CSV 容器矩形**(clampRectsToBounds 防 grid getClientRects
    //   整行铺满溢出文件树/聊天,Image#34/#35)→ 与其他格式统一蓝、右键后不再消失。
    const best = viewerHistory?.pickBestRecent() ?? null
    if (best && best.text.trim()) {
      text = best.text
      range = best.range
    }
    if (!text) {
      const sel = typeof window !== "undefined" ? window.getSelection() : null
      if (sel && sel.rangeCount > 0) {
        const t = sel.toString()
        if (t.trim()) {
          text = t
          range = sel.getRangeAt(0).cloneRange()
        }
      }
    }
    // 画 overlay 蓝 + 裁到 CSV 容器矩形(防 grid 矩形溢出);range 为 null 时内部自动清空
    const csvBounds = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect() ?? null
    setSelectionHighlight(range, csvBounds)
    if (range) {
      // 恢复 collapse 掉的原生选区,让 OS 蓝色高亮重新覆盖原文本范围。
      try {
        const sel = typeof window !== "undefined" ? window.getSelection() : null
        if (sel) {
          sel.removeAllRanges()
          sel.addRange(range.cloneRange())
        }
      } catch {
        // 恢复失败不影响菜单功能
      }
    }
    setMdComment("")
    setMdMenu({ open: true, x: event.clientX, y: event.clientY, text, mode: "menu" })
  }

  // FORK: CSV/TSV 表格视图 [feat: csv-table-viewer] 2026-06-14
  const renderCsv = (source: string) => (
    <div class="h-full min-h-0" onContextMenu={handleCsvContextMenu}>
      <CsvTable
        text={source}
        onOpenExternal={() => {
          const root = sdk().directory
          const p = path()
          if (!root || !p) return
          invoke("open_path", { path: `${root}/${p}`.replace(/\\/g, "/"), appName: null }).catch((e) => {
            showToast({ variant: "error", title: "无法用本机软件打开", description: String(e) })
          })
        }}
      />
    </div>
  )

  const renderFile = (source: string) => {
    const p = path()
    // FORK: 大文件预览统一防护 — L1 闸门已在 context/file.tsx load() 命中,UI 渲染 FileTooLarge
    // [feat: large-file-preview-guard] 2026-05-21
    const tooLarge = state()?.tooLarge
    if (tooLarge && p) {
      return (
        <FileTooLarge
          path={p}
          root={sdk().directory ?? ""}
          size={tooLarge.size}
          category={tooLarge.category}
          limit={tooLarge.limit}
        />
      )
    }
    if (isMarkdownPath(p)) return renderMarkdown(source)
    // FORK: pdf/office 走 renderDefault → File/FileMedia 的 pdf 分支 → DocumentViewer(pdf.js TextLayer 可选中
    //   + 右键加聊天,与 md 同一套选区机制)。必须在 mediaKindFromPath 之前,因 pdfLikeExtensions 含 office
    //   会让它们落到无 pdf 分支的 renderMedia → 空白。[feat: pdf-render-path] 2026-06-14
    if (isPdfLikePath(p)) return renderDefault(source)
    if (mediaKindFromPath(p)) return renderMedia()
    if (isHtmlPath(p)) return renderHtml(source)
    // FORK: csv/tsv 走表格视图 [feat: csv-table-viewer] 2026-06-14
    if (isCsvPath(p)) return renderCsv(source)
    return renderDefault(source)
  }

  return (
    <Tabs.Content
      value={props.tab}
      class="mt-3 relative h-full flex flex-col"
      // FORK: Ctrl+C v2 — 标识本 FileTabContent 实例的 viewer 根节点(scope 闸用)。
      // anchor.closest('[data-component="file-viewer"]') 命中即认为选区在本 tab 内,
      // 跨 tab 不相同节点,自动隔离。2026-05-29
      data-component="file-viewer"
      // FORK: REQ-097 — 文件预览区 ⌘F 不触发会话查找(查找作用域注册口)[feat: in-session-find]
      data-deskfox-find-ignore
      ref={(el: HTMLElement) => { viewerRootRef = el }}
    >
      <Show when={editing()}>
        <div class="flex items-center justify-between px-4 py-1.5 border-b border-border-base bg-surface-raised-stronger-non-alpha shadow-sm">
          <button
            onClick={saveEdit}
            disabled={!dirty()}
            class="text-xs px-2 py-1 rounded border border-border-base hover:bg-surface-base-hover disabled:opacity-50"
          >
            保存{dirty() ? " *" : ""}
          </button>
          <button
            onClick={cancelEdit}
            class="text-xs px-2 py-1 rounded border border-border-base hover:bg-surface-base-hover"
          >
            关闭
          </button>
        </div>
      </Show>
      <ScrollView class="h-full" viewportRef={scrollSync.setViewport} onScroll={scrollSync.handleScroll as any}>
        <Switch>
          <Match when={editing() && state()?.loaded}>
            {/* FORK: 去掉 overflow-hidden — 否则 cm-panels-top 的 position: sticky 会绑到本 wrapper(它不滚),
                导致搜索面板被外层 ScrollView 一起滚走;让 sticky 链路穿过此 wrapper 直达 ScrollView 视口 2026-05-05 */}
            <div class="relative p-2" style={{ "min-height": "300px" }}>
              <CodeMirrorView
                value={contents()}
                language={langFromExt(path() ?? "")}
                onChange={setDraft}
                // FORK: md-editing-iter-2 — 光标 / 选区状态上报状态栏 2026-05-09
                onCursorChange={setCursorInfo}
                // FORK: .md 文件编辑态注入 markdown 增强扩展 — 列表续延 / 拖图 / Ctrl+F 等 2026-05-05
                extraExtensions={
                  isMarkdownPath(path())
                    ? markdownEditorExtensions({
                        projectRoot: sdk().directory,
                        filePathRel: path() ?? undefined,
                        locale: language.locale(),
                      })
                    : undefined
                }
              />
              {/* FORK: md-editing-iter-2 — 编辑态状态栏 2026-05-09 */}
              <CmStatusBar info={cursorInfo()} />
            </div>
          </Match>
          <Match when={state()?.loaded}>{renderFile(contents())}</Match>
          <Match when={state()?.loading}>
            <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
          </Match>
          <Match when={state()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
        </Switch>
      </ScrollView>
      <Show when={highlightRects()}>
        <Portal mount={document.body}>
          <For each={highlightRects()!}>
            {(rect) => (
              <div
                class="fixed pointer-events-none z-40"
                style={{
                  left: `${rect.left}px`,
                  top: `${rect.top}px`,
                  width: `${rect.width}px`,
                  height: `${rect.height}px`,
                  "background-color": "rgba(56, 139, 253, 0.4)", // FORK: 统一选区蓝(原 #d13438 红)→ 与原生 ::selection 同系,各格式视觉一致 [feat: viewer-selection-tray-style]
                }}
              />
            )}
          </For>
        </Portal>
      </Show>
      <Show when={mdMenu().open}>
        <Portal mount={document.body}>
          <Switch>
            <Match when={mdMenu().mode === "menu"}>
              <div
                ref={(el) => { mdMenuEl = el }}
                data-slot="md-selection-menu"
                class="fixed z-50 min-w-[220px] rounded-md border border-border-base bg-surface-raised-stronger-non-alpha text-text-strong shadow-[var(--shadow-lg-border-base)] py-1 text-sm"
                style={{ left: `${mdMenu().x}px`, top: `${mdMenu().y}px`, visibility: "hidden" }}
              >
                {/* FORK: 始终显示完整菜单(2026-05-07)— 选区相关项(添加到聊天 / 复制)按
                    mdMenu().text.trim() disabled 灰显;编辑 / 导出 Word 不依赖选区,始终可用。
                    UX 一致性:user 一眼看到全部能做的事,不用先选文字才知道有"导出 Word"。
                    [feat: menu-always-show-with-disabled] */}
                <button
                  class="w-full text-left px-3 py-1.5 hover:bg-surface-base-hover disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!mdMenu().text.trim()}
                  onClick={openMdInputPanel}
                >
                  {language.t("fileViewer.menu.addToChat")}
                </button>
                <button
                  class="w-full text-left px-3 py-1.5 hover:bg-surface-base-hover disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!canEdit() || !state()?.loaded}
                  title={editDisabledReason()}
                  onClick={startEditFromMenu}
                >
                  {language.t("common.edit")}
                </button>
                <div class="my-1 border-t border-border-base" />
                <button
                  class="w-full px-3 py-1.5 hover:bg-surface-base-hover flex justify-between items-center gap-6 disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!mdMenu().text.trim()}
                  onClick={copyMdSelection}
                >
                  <span>{language.t("fileViewer.menu.copy")}</span>
                  <span class="text-xs text-text-weak">Ctrl+C</span>
                </button>
                <div class="my-1 border-t border-border-base" />
                <button
                  class="w-full text-left px-3 py-1.5 hover:bg-surface-base-hover disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!isMarkdownPath(path())}
                  title={isMarkdownPath(path()) ? undefined : language.t("fileViewer.menu.exportDocxOnlyMd")}
                  onClick={() => void onExportDocx()}
                >
                  {language.t("fileViewer.menu.exportDocx")}
                </button>
              </div>
            </Match>
            <Match when={mdMenu().mode === "input"}>
              <div
                ref={(el) => { mdMenuEl = el }}
                data-slot="md-selection-menu"
                class="fixed z-50 w-[360px] rounded-md border border-border-base bg-surface-raised-stronger-non-alpha text-text-strong shadow-[var(--shadow-lg-border-base)] p-3 text-sm flex flex-col gap-2"
                style={{ left: `${mdMenu().x}px`, top: `${mdMenu().y}px`, visibility: "hidden" }}
              >
                <textarea
                  // FORK: focus 已由上方 createEffect + rAF 接管(visibility:hidden race);
                  // 不在 ref 里 queueMicrotask focus,避免 silent fail 之后焦点跑回上次有焦点的元素 2026-05-29
                  class="w-full min-h-[80px] rounded border border-border-base bg-background-base px-2 py-1.5 text-sm text-text-strong placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-text-interactive-base resize-y"
                  placeholder={language.t("fileViewer.menu.input.placeholder")}
                  value={mdComment()}
                  onInput={(e) => setMdComment(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return
                    // FORK: REQ-082 对齐主输入框键位 —— Shift+Enter 换行(textarea 默认,先于 IME 判)/
                    // IME 组合态跳过 / 裸 Enter 提交 2026-07-13
                    if (e.shiftKey) return
                    if (isImeComposingEvent(e)) return
                    e.preventDefault()
                    submitMdSelection()
                  }}
                />
                <div class="flex items-center justify-between">
                  <span class="text-[11px] text-text-weak">
                    {language.t("fileViewer.menu.input.shortcutHint")}
                  </span>
                  <div class="flex items-center gap-2">
                    <button
                      class="text-xs px-2 py-1 rounded border border-border-base hover:bg-surface-base-hover"
                      onClick={closeMdMenu}
                    >
                      {language.t("common.cancel")}
                    </button>
                    <button
                      class="text-xs px-2 py-1 rounded border border-border-base bg-surface-base hover:bg-surface-base-hover"
                      onClick={submitMdSelection}
                    >
                      {language.t("fileViewer.menu.input.submit")}
                    </button>
                  </div>
                </div>
              </div>
            </Match>
          </Switch>
        </Portal>
      </Show>
    </Tabs.Content>
  )
}

// FORK 兼容层(2026-08-11 sync v1.18.4):上游把文件渲染抽成 SessionFileView(v2 inline file browser 用),
// DeskFox 保留段2 文件查看器主体;此 shim 复用 FileTabContent 满足 v2 浏览器 tab 的最小契约
// (diff 详情增强等 v2 专属能力待段4 评估)。
import type { RenderDiff as V2RenderDiff } from "@/pages/session/v2/review-diff-kinds"
export type SessionFileViewProps = {
  tab: string
  diff?: V2RenderDiff
  diffVersion?: number
  loadDiff?: (path: string, version?: number) => Promise<V2RenderDiff | undefined>
  expandUnchanged?: boolean
}
export function SessionFileView(props: SessionFileViewProps) {
  return <FileTabContent tab={props.tab} />
}
