// FORK-ONLY: exact-file native preview contract [feat: daily-file-links] 2026-11-14
// Mirror desktop/src/main/deskfox/document-preview.ts; never authorize a parent directory.
export type DocumentPreview =
  | { ok: true; path: string; kind: "text" | "markdown" | "pdf" | "office"; content: string }
  | {
      ok: false
      reason:
        | "invalid"
        | "missing"
        | "permission"
        | "unreachable"
        | "directory"
        | "unsupported"
        | "too-large"
        | "encoding"
        | "read"
    }

const errors = {
  invalid: "文件路径无效",
  missing: "文件不存在，或所在磁盘尚未连接",
  permission: "没有读取此文件的权限",
  unreachable: "无法访问文件所在磁盘",
  directory: "此链接未指向可预览的普通文件",
  unsupported: "暂不支持在此处预览此文件类型",
  "too-large": "文件过大：文本预览最多 2 MiB，PDF 和 Office 文档最多 50 MiB",
  encoding: "文件不是可预览的 UTF-8 文本",
  read: "读取文件失败",
}

export function createDocumentPreviewOpener(input: {
  source: () => string | undefined
  read: (path: string) => Promise<DocumentPreview>
  show: (document: Extract<DocumentPreview, { ok: true }>, fragment: string) => void
}) {
  return async (path: string, fragment: string) => {
    const source = input.source()
    if (!source) throw new Error("项目外文件预览仅支持本机桌面会话；不会打开远程电脑或 WSL 路径的本机同名文件")
    const result = await input.read(path)
    if (source !== input.source()) throw new Error("连接已切换，请重新点击文件链接")
    if (!result.ok) throw new Error(errors[result.reason])
    input.show(result, fragment)
  }
}

export function documentBytes(base64: string) {
  return Uint8Array.from(atob(base64), (value) => value.charCodeAt(0))
}
