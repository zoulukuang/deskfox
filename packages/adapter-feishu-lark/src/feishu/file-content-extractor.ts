// FORK: 飞书文件消息内容抽取 — REQ-035
// [feat: feishu-file-and-quote-recv] 2026-06-02
//
// 职责:从飞书下载的文件 buffer 中抽取可读纯文本,供喂给 LLM 使用。
// 架构说明:抽取结果以 text part 注入 user message,对所有 opencode agent
//   (imbot / build / claude-code plugin 等)均有效,不依赖 system prompt。
//
// 格式支持清单(v3 2026-06-03):
//   text 类(txt/md/csv/json/常见代码后缀) — UTF-8 直读,无依赖
//   docx — fflate unzip + word/document.xml XML 文本抽取
//   xlsx — fflate unzip + sharedStrings + sheet XML 抽取
//   pptx — fflate unzip + ppt/slides/slideN.xml <a:t> 抽取
//   pdf  — pdfjs-dist 4.x 异步文本抽取;扫描版/加密 graceful 降级
//   image(png/jpg/webp 等) — message-pipeline 走多模态 vision 路径
//   legacy_office(xls/ppt/doc) — "请另存为现代格式"提示
//   unsupported — "暂不支持"提示

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"
import { unzipSync } from "fflate"

// Bun plugin bundle 单线程运行,禁用 Web Worker
GlobalWorkerOptions.workerSrc = ""

/** 支持的文件格式档位 */
export type FileFormat =
  | "text"
  | "docx"
  | "xlsx"
  | "pptx"
  | "pdf"
  | "image"
  | "legacy_office"
  | "unsupported"

/** 抽取结果 */
export interface ExtractResult {
  /** 抽取到的可读纯文本(已截断到 MAX_TEXT_CHARS)*/
  text: string
  /** 是否因超限而截断 */
  truncated: boolean
}

/** 文本截断上限:50000 字符 ≈ 12500-16500 tokens,覆盖普通学术论文长度 */
export const MAX_TEXT_CHARS = 50_000

/** 图片扩展名 → MIME 映射 */
const IMAGE_MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  ico: "image/x-icon",
}

/** 旧版 Office 二进制格式 → 对应的现代格式名 */
const LEGACY_OFFICE_MAP: Record<string, string> = {
  xls: "xlsx", xlsm: "xlsx", xlsb: "xlsx",
  doc: "docx",
  ppt: "pptx", pptm: "pptx",
}

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
  if (ext === "xlsx") return "xlsx"
  if (ext === "pptx") return "pptx"
  if (ext === "pdf") return "pdf"
  if (ext in IMAGE_MIME_MAP) return "image"
  if (ext in LEGACY_OFFICE_MAP) return "legacy_office"
  return "unsupported"
}

/**
 * 根据文件名返回图片 MIME type。
 * 仅对 `detectFileFormat` 返回 "image" 的格式有意义。
 */
export function getImageMime(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  if (dot === -1) return "image/png"
  const ext = fileName.slice(dot + 1).toLowerCase()
  return IMAGE_MIME_MAP[ext] ?? "image/jpeg"
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
    case "xlsx":
      return extractXlsxText(buf, fileName)
    case "pptx":
      return extractPptxText(buf, fileName)
    case "pdf":
      // PDF 应走 extractPdfTextAsync(async);此同步路径仅作兜底
      return {
        text: `⚠️ PDF 文件《${fileName}》需要异步解析,请调用 extractPdfTextAsync。`,
        truncated: false,
      }
    case "image":
      // 图片应走 message-pipeline 多模态 vision 路径
      return {
        text: `⚠️ 图片文件《${fileName}》需要多模态 LLM 识别,请走 vision 注入路径。`,
        truncated: false,
      }
    case "legacy_office": {
      const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase()
      const modern = LEGACY_OFFICE_MAP[ext] ?? "xlsx/docx/pptx"
      return {
        text: `⚠️ 旧版 Office 格式《${fileName}》暂不支持直接解析。\n请在 Excel/Word/PowerPoint 中另存为 .${modern} 后重发。`,
        truncated: false,
      }
    }
    case "unsupported":
      return {
        text: `⚠️ 暂不支持读取《${fileName}》格式。\n目前支持:图片 / txt / md / csv / json / 代码文件 / docx / xlsx / pptx / pdf。`,
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

// FORK-BEGIN: xlsx / pptx 文本抽取 2026-06-03

/**
 * xlsx 文本抽取。
 * xlsx = ZIP(OOXML)格式:
 *   - xl/sharedStrings.xml: 共享字符串表(大多数文本都在这里)
 *   - xl/worksheets/sheetN.xml: 单元格数据(引用 sharedStrings 或内联数值)
 * 输出格式:每行 tab 分隔的单元格值。
 */
function extractXlsxText(buf: Uint8Array, fileName: string): ExtractResult {
  try {
    const files = unzipSync(buf)
    const dec = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: false }).decode(b)

    // 1. 解析共享字符串表
    const sharedStrings: string[] = []
    if (files["xl/sharedStrings.xml"]) {
      const ssXml = dec(files["xl/sharedStrings.xml"])
      // 每个 <si>...</si> 块是一条共享字符串,内部可能有多个 <t> 拼接
      for (const siBlock of ssXml.split("</si>")) {
        const texts: string[] = []
        for (const m of siBlock.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
          texts.push(decodeXmlEntities(m[1]))
        }
        sharedStrings.push(texts.join(""))
      }
      // split 会多一个空尾部
      if (sharedStrings.length > 0) sharedStrings.pop()
    }

    // 2. 找所有 sheet 文件并排序
    const sheetFiles = Object.keys(files)
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)?.[0] ?? "0", 10)
        const nb = parseInt(b.match(/\d+/)?.[0] ?? "0", 10)
        return na - nb
      })

    if (sheetFiles.length === 0) {
      return { text: `⚠️ xlsx 文件《${fileName}》内未找到 worksheet`, truncated: false }
    }

    // 3. 抽取每个 sheet 的单元格值
    const lines: string[] = []
    for (const sheetFile of sheetFiles) {
      const xml = dec(files[sheetFile])
      // 逐行提取
      for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = []
        for (const cellMatch of rowMatch[1].matchAll(/<c[^>]*>([\s\S]*?)<\/c>/g)) {
          const cellXml = cellMatch[0]
          // t="s" → shared string index; t="str" → inline string; 无 t → 数值
          const isShared = /\bt="s"/.test(cellXml)
          const isInline = /\bt="str"/.test(cellXml) || /\bt="inlineStr"/.test(cellXml)
          if (isInline) {
            const tMatch = cellXml.match(/<(?:t|is)[^>]*>([\s\S]*?)<\/(?:t|is)>/)
            cells.push(tMatch ? decodeXmlEntities(tMatch[1]) : "")
          } else {
            const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/)
            if (!vMatch) { cells.push(""); continue }
            const raw = decodeXmlEntities(vMatch[1])
            if (isShared) {
              const idx = parseInt(raw, 10)
              cells.push(isNaN(idx) ? raw : (sharedStrings[idx] ?? raw))
            } else {
              cells.push(raw)
            }
          }
        }
        if (cells.some((c) => c.trim())) lines.push(cells.join("\t"))
      }
    }

    const fullText = lines.join("\n").trim()
    if (!fullText) return { text: `⚠️ xlsx 文件《${fileName}》内容为空`, truncated: false }
    return truncate(fullText)
  } catch (e) {
    return { text: `⚠️ xlsx 解析失败《${fileName}》:${(e as Error).message ?? e}`, truncated: false }
  }
}

/**
 * pptx 文本抽取。
 * pptx = ZIP(OOXML),每页幻灯片在 ppt/slides/slideN.xml。
 * 提取所有 <a:t> 文本节点,按页组织输出。
 */
function extractPptxText(buf: Uint8Array, fileName: string): ExtractResult {
  try {
    const files = unzipSync(buf)
    const dec = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: false }).decode(b)

    const slideFiles = Object.keys(files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)?.[0] ?? "0", 10)
        const nb = parseInt(b.match(/\d+/)?.[0] ?? "0", 10)
        return na - nb
      })

    if (slideFiles.length === 0) {
      return { text: `⚠️ pptx 文件《${fileName}》内未找到幻灯片`, truncated: false }
    }

    const slideParts: string[] = []
    for (let i = 0; i < slideFiles.length; i++) {
      const xml = dec(files[slideFiles[i]])
      const texts: string[] = []
      for (const m of xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)) {
        const t = decodeXmlEntities(m[1]).trim()
        if (t) texts.push(t)
      }
      if (texts.length > 0) slideParts.push(`第${i + 1}页:\n${texts.join(" ")}`)
    }

    const fullText = slideParts.join("\n\n").trim()
    if (!fullText) {
      return { text: `⚠️ pptx 文件《${fileName}》内容为空或全为图片`, truncated: false }
    }
    return truncate(fullText)
  } catch (e) {
    return { text: `⚠️ pptx 解析失败《${fileName}》:${(e as Error).message ?? e}`, truncated: false }
  }
}
// FORK-END

// FORK-BEGIN: PDF 异步文本抽取 via pdfjs-dist 2026-06-03
/**
 * 从 PDF buffer 抽取纯文本。异步,不抛(失败返友好提示)。
 *
 * - 正常 PDF → 逐页 getTextContent() 拼文本 → truncate(MAX_TEXT_CHARS)
 * - 扫描版 / 全图 PDF → 返"无可提取文字"提示
 * - 加密 / 损坏 → 返具体 error 提示
 *
 * GlobalWorkerOptions.workerSrc = "" 已在模块级别设置(Bun 单线程,无 Web Worker)。
 *
 * 导出供单测覆盖。
 */
export async function extractPdfTextAsync(
  buf: Uint8Array,
  fileName: string,
): Promise<ExtractResult> {
  try {
    const pdf = await getDocument({ data: buf, verbosity: 0 }).promise
    const pageParts: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      // TextItem 有 str 字段;TextMarkedContent 无 — 过滤后用 unknown 转换绕开 union 类型限制
      const pageText = content.items
        .filter((item) => "str" in item)
        .map((item) => {
          const t = item as unknown as { str: string; hasEOL?: boolean }
          return t.str + (t.hasEOL ? "\n" : "")
        })
        .join("")
      if (pageText.trim()) pageParts.push(pageText.trim())
    }
    const fullText = pageParts.join("\n\n").trim()
    if (!fullText) {
      return {
        text: `⚠️ PDF 文件《${fileName}》无可提取文字(可能是扫描版 / 全图 PDF,文字层缺失)。\n如需识别文字请用 OCR 工具转换后重发。`,
        truncated: false,
      }
    }
    return truncate(fullText)
  } catch (e) {
    const msg = (e as Error).message ?? String(e)
    return {
      text: `⚠️ PDF 解析失败《${fileName}》:${msg}\n可能原因:文件已加密 / 损坏 / 格式不标准。请转换为 .txt 或 .docx 后重发。`,
      truncated: false,
    }
  }
}
// FORK-END
