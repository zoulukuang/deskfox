// FORK: 飞书文件消息内容抽取 — REQ-035
// [feat: feishu-file-and-quote-recv] 2026-06-02
//
// 职责:从飞书下载的文件 buffer 中抽取可读纯文本,供喂给 LLM 使用。
// 架构说明:抽取结果以 text part 注入 user message,对所有 opencode agent
//   (imbot / build / claude-code plugin 等)均有效,不依赖 system prompt。
//
// MVP 格式支持清单:
//   text 类(txt/md/csv/json/常见代码后缀) — UTF-8 直读,无依赖
//   docx — fflate unzip + word/document.xml XML 文本抽取
//   pdf  — graceful skip(提示转 txt/docx),原因:pure-JS PDF 解析库内部大量依赖
//          Buffer.isBuffer(),与 Bun plugin bundle CJS 模式存在已知兼容风险,
//          见 reference_bun_plugin_form_data_trap.md。二期专项。
//   其他 — "暂不支持"提示
//
// Pure functions,便于单测,0 IO。

import { unzipSync } from "fflate"

/** MVP 支持的文件格式档位 */
export type FileFormat = "text" | "docx" | "pdf" | "unsupported"

/** 抽取结果 */
export interface ExtractResult {
  /** 抽取到的可读纯文本(已截断到 MAX_TEXT_CHARS)*/
  text: string
  /** 是否因超限而截断 */
  truncated: boolean
}

/** 文本截断上限:20000 字符 ≈ 5000-8000 tokens,多数 LLM 上下文友好 */
export const MAX_TEXT_CHARS = 20_000

/** 常见代码/文本扩展名集合(小写) */
const TEXT_EXTS: ReadonlySet<string> = new Set([
  "txt", "md", "markdown", "csv", "json", "jsonl",
  "js", "ts", "jsx", "tsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "swift", "c", "cpp", "h", "hpp",
  "cs", "php", "sh", "bash", "zsh", "fish",
  "yaml", "yml", "toml", "ini", "conf", "env",
  "html", "htm", "xml", "svg", "css", "scss", "less",
  "sql", "graphql", "gql",
  "r", "m", "pl", "lua", "ex", "exs",
])

/**
 * 根据文件名(扩展名)判断格式档位。
 * 纯函数,大小写不敏感。
 */
export function detectFileFormat(fileName: string): FileFormat {
  const dot = fileName.lastIndexOf(".")
  if (dot === -1) return "unsupported"
  const ext = fileName.slice(dot + 1).toLowerCase()
  if (TEXT_EXTS.has(ext)) return "text"
  if (ext === "docx") return "docx"
  if (ext === "pdf") return "pdf"
  return "unsupported"
}

/**
 * 从 buffer 抽取文本。纯函数,不抛(失败返空文本 + truncated=false)。
 *
 * @param buf   文件的原始字节(Uint8Array,避免 Bun bundle Buffer 兼容问题)
 * @param format detectFileFormat 结果
 * @param fileName  原始文件名(用于 docx 内部路径 / 错误提示)
 */
export function extractTextFromBuffer(
  buf: Uint8Array,
  format: FileFormat,
  fileName: string,
): ExtractResult {
  switch (format) {
    case "text":
      return extractPlainText(buf)
    case "docx":
      return extractDocxText(buf)
    case "pdf":
      return {
        text: `⚠️ 暂不支持读取 PDF 文件《${fileName}》(PDF 解析功能开发中)。\n请将内容另存为 .txt 或 .docx 后重新发送。`,
        truncated: false,
      }
    case "unsupported":
      return {
        text: `⚠️ 暂不支持读取《${fileName}》格式。\n目前支持:txt / md / csv / json / 常见代码文件 / docx。`,
        truncated: false,
      }
  }
}

// ============================================================
// 内部实现
// ============================================================

function truncate(text: string): ExtractResult {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false }
  return {
    text: text.slice(0, MAX_TEXT_CHARS) + `\n\n…(内容已截断,共 ${text.length} 字,仅展示前 ${MAX_TEXT_CHARS} 字)`,
    truncated: true,
  }
}

function extractPlainText(buf: Uint8Array): ExtractResult {
  try {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf).trim()
    return truncate(text)
  } catch {
    return { text: "⚠️ 文件读取失败(编码问题)", truncated: false }
  }
}

function extractDocxText(buf: Uint8Array): ExtractResult {
  try {
    // docx = ZIP 归档,fflate.unzipSync 返 { [path]: Uint8Array }
    // word/document.xml 是正文主体
    const files = unzipSync(buf)
    const docXml = files["word/document.xml"]
    if (!docXml) return { text: "⚠️ docx 内未找到 word/document.xml(文件可能损坏)", truncated: false }

    const xml = new TextDecoder("utf-8", { fatal: false }).decode(docXml)
    const text = stripDocxXml(xml)
    if (!text.trim()) return { text: "⚠️ docx 内容为空或无法提取文字", truncated: false }
    return truncate(text)
  } catch (e) {
    return { text: `⚠️ docx 解析失败:${(e as Error).message ?? e}`, truncated: false }
  }
}

/**
 * 从 word/document.xml 抽取纯文本。
 *
 * docx XML 结构简介:
 *   <w:body>
 *     <w:p>(段落)
 *       <w:r>(run)
 *         <w:t>实际文字</w:t>
 *       </w:r>
 *     </w:p>
 *   </w:body>
 *
 * 做法:提取所有 <w:t> 的文本内容,段落(</w:p>)之间加换行。
 * 纯文本导向,不保留格式(粗体/颜色等),满足 LLM 内容理解需求。
 *
 * 导出供单测覆盖。
 */
export function stripDocxXml(xml: string): string {
  const lines: string[] = []
  let current = ""

  // 简单状态机:逐段处理标签
  let i = 0
  while (i < xml.length) {
    if (xml[i] === "<") {
      // 找到标签结束
      const end = xml.indexOf(">", i)
      if (end === -1) break
      const tag = xml.slice(i + 1, end)
      const tagName = tag.replace(/^\//, "").split(" ")[0]?.toLowerCase() ?? ""

      if (tagName === "w:t") {
        // 收集到下一个 < 之间的文本
        const textStart = end + 1
        const textEnd = xml.indexOf("<", textStart)
        if (textEnd !== -1) {
          current += decodeXmlEntities(xml.slice(textStart, textEnd))
          i = textEnd
          continue
        }
      } else if (tagName === "w:p" && tag.startsWith("/")) {
        // 段落结束:把当前段加到 lines
        if (current.trim()) lines.push(current)
        current = ""
      } else if (tagName === "w:br") {
        // 换行符
        current += "\n"
      }
      i = end + 1
    } else {
      i++
    }
  }
  if (current.trim()) lines.push(current)
  return lines.join("\n")
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}
