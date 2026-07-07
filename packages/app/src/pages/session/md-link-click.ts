// FORK-ONLY: REQ-075 markdown 内链点击拦截共享实现 [feat: batch-port-edit-mdlink] 2026-07-07
//
// 从 file-tabs.tsx handleMdLinkClick 提取参数化:文件预览区(baseDir=当前文件所在目录)与
// 聊天区(baseDir=项目根,user 2026-07-07 拍板)共用同一套
// 「相对路径解析 → 越权校验 → 存在性探测 → 开预览 tab」链路。
// 聊天区此前完全没接线 → 相对链接走浏览器原生 <a> 导航把整个 SPA 导航掉,主内容区变空白。
// toast / checkExists 由调用方注入(showToast / invoke("get_file_mtime")),本模块只依赖纯路径函数。
import { resolveAbsolute } from "@/utils/local-asset"

export type MdLinkToast = { variant: "error"; title: string; description: string }

export function createMdLinkClickHandler(input: {
  /** 项目根(越权边界);undefined = 不拦截 */
  root: () => string | undefined
  /** 相对路径解析基准目录(绝对路径);undefined = 不拦截 */
  baseDir: () => string | undefined
  /** 命中项目内存在的文件 → 开预览 tab */
  onOpen: (rel: string) => void
  /** 存在性探测,resolve = 存在(生产传 invoke("get_file_mtime")) */
  checkExists: (root: string, rel: string) => Promise<unknown>
  toast: (t: MdLinkToast) => void
}) {
  return (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target
    if (!(target instanceof Element)) return
    const link = target.closest("a") as HTMLAnchorElement | null
    if (!link) return
    const href = link.getAttribute("href")
    if (!href) return
    // 跳过外链 / data / blob;锚点(#xxx)留给浏览器原生处理
    if (/^(https?|mailto|data|blob|tauri|localasset|file|javascript):/i.test(href)) return
    if (href.startsWith("//")) return
    if (href.startsWith("#")) return

    const root = input.root()
    const base = input.baseDir()
    if (!root || !base) return

    const targetAbs = resolveAbsolute(base, href)
    const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "")
    // 越权防护:解析后必须在项目根内
    if (!targetAbs.startsWith(normRoot + "/") && targetAbs !== normRoot) {
      input.toast({ variant: "error", title: "链接超出项目范围", description: targetAbs })
      event.preventDefault()
      return
    }

    const rel = targetAbs.startsWith(normRoot + "/") ? targetAbs.slice(normRoot.length + 1) : ""
    if (rel) {
      // 永远 preventDefault — 阻断原生导航(REQ-075 SPA 变空白的根因)
      event.preventDefault()
      // 异步检查文件存在;不存在 → toast 提示,不开 tab
      input
        .checkExists(root, rel)
        .then(() => input.onOpen(rel))
        .catch(() => {
          input.toast({ variant: "error", title: "文件不存在", description: rel })
        })
    } else {
      // 没拿到合法相对路径(可能解析到根本身)— 也阻止默认,防原生导航
      event.preventDefault()
    }
  }
}
