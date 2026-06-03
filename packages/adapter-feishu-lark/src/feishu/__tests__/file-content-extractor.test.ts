// FORK: file-content-extractor 单测 — REQ-035
// [feat: feishu-file-and-quote-recv] 2026-06-02
//
// 覆盖 R8 测试用例清单 F1-F9 + stripDocxXml 辅助测试。
// 纯函数,0 IO,速度快。

import { describe, expect, test } from "bun:test"
import {
  detectFileFormat,
  extractTextFromBuffer,
  MAX_TEXT_CHARS,
  stripDocxXml,
} from "../file-content-extractor"
import { zipSync } from "fflate"

// ============================================================
// F1-F5 detectFileFormat
// ============================================================

describe("detectFileFormat (F1-F5)", () => {
  test("F1: txt → 'text'", () => {
    expect(detectFileFormat("readme.txt")).toBe("text")
  })
  test("F2: csv → 'text'", () => {
    expect(detectFileFormat("data.csv")).toBe("text")
  })
  test("F2b: json → 'text'", () => {
    expect(detectFileFormat("config.json")).toBe("text")
  })
  test("F2c: 代码文件 .ts → 'text'", () => {
    expect(detectFileFormat("main.ts")).toBe("text")
  })
  test("F2d: markdown → 'text'", () => {
    expect(detectFileFormat("README.md")).toBe("text")
  })
  test("F3: docx → 'docx'", () => {
    expect(detectFileFormat("report.docx")).toBe("docx")
  })
  test("F4: pdf → 'pdf'", () => {
    expect(detectFileFormat("slides.pdf")).toBe("pdf")
  })
  test("F5: png → 'unsupported'", () => {
    expect(detectFileFormat("image.png")).toBe("unsupported")
  })
  test("F5b: xlsx → 'unsupported'", () => {
    expect(detectFileFormat("table.xlsx")).toBe("unsupported")
  })
  test("大写扩展名不敏感", () => {
    expect(detectFileFormat("FILE.TXT")).toBe("text")
    expect(detectFileFormat("FILE.DOCX")).toBe("docx")
    expect(detectFileFormat("FILE.PDF")).toBe("pdf")
  })
  test("无扩展名 → 'unsupported'", () => {
    expect(detectFileFormat("Makefile")).toBe("unsupported")
  })
})

// ============================================================
// F6 extractTextFromBuffer — txt 格式
// ============================================================

describe("extractTextFromBuffer — text (F6)", () => {
  test("F6: UTF-8 文本文件 → 返回文本内容", () => {
    const content = "这是一段测试文本\n第二行\n第三行"
    const buf = new TextEncoder().encode(content)
    const result = extractTextFromBuffer(buf, "text", "note.txt")
    expect(result.text).toBe(content)
    expect(result.truncated).toBe(false)
  })

  test("F6b: 英文代码文件 → 正确解码", () => {
    const code = 'function hello() {\n  console.log("world")\n}'
    const buf = new TextEncoder().encode(code)
    const result = extractTextFromBuffer(buf, "text", "hello.js")
    expect(result.text).toBe(code)
    expect(result.truncated).toBe(false)
  })
})

// ============================================================
// F8 截断逻辑
// ============================================================

describe("extractTextFromBuffer — 截断 (F8)", () => {
  test("F8: 超 50000 字 → 截断 + truncated=true", () => {
    const longText = "a".repeat(MAX_TEXT_CHARS + 500)
    const buf = new TextEncoder().encode(longText)
    const result = extractTextFromBuffer(buf, "text", "big.txt")
    expect(result.truncated).toBe(true)
    expect(result.text.length).toBeLessThan(longText.length)
    expect(result.text).toContain("内容已截断")
    expect(result.text).toContain(String(MAX_TEXT_CHARS))
  })

  test("恰好 50000 字 → 不截断", () => {
    const text = "x".repeat(MAX_TEXT_CHARS)
    const buf = new TextEncoder().encode(text)
    const result = extractTextFromBuffer(buf, "text", "exact.txt")
    expect(result.truncated).toBe(false)
    expect(result.text).toBe(text)
  })
})

// ============================================================
// F9 PDF graceful skip
// ============================================================

describe("extractTextFromBuffer — pdf (F9)", () => {
  test("F9: pdf → 返回提示文本,不抛,truncated=false", () => {
    const buf = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // PDF header magic
    const result = extractTextFromBuffer(buf, "pdf", "report.pdf")
    expect(result.truncated).toBe(false)
    expect(result.text).toContain("暂不支持读取 PDF")
    expect(result.text).toContain("report.pdf")
    expect(result.text).toContain(".txt")
  })
})

// ============================================================
// F5 unsupported graceful
// ============================================================

describe("extractTextFromBuffer — unsupported", () => {
  test("unsupported → 友好提示,不抛", () => {
    const buf = new Uint8Array([0xff, 0xfe])
    const result = extractTextFromBuffer(buf, "unsupported", "table.xlsx")
    expect(result.truncated).toBe(false)
    expect(result.text).toContain("暂不支持")
    expect(result.text).toContain("table.xlsx")
  })
})

// ============================================================
// F7 docx 提取
// ============================================================

describe("extractTextFromBuffer — docx (F7)", () => {
  /**
   * 构造一个最小化的合法 docx (ZIP + word/document.xml)。
   * fflate.zipSync 生成 ZIP bytes(Uint8Array)。
   */
  function makeMinimalDocx(paragraphs: string[]): Uint8Array {
    // word/document.xml 段落结构
    const paraXml = paragraphs
      .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
      .join("")
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${paraXml}</w:body></w:document>`
    const xmlBytes = new TextEncoder().encode(xml)
    // 也需要 [Content_Types].xml 使 docx valid,但 extractor 只用 word/document.xml
    const files = {
      "word/document.xml": xmlBytes,
    }
    return zipSync(files)
  }

  test("F7: docx 样本 → 返回段落文本", () => {
    const docx = makeMinimalDocx(["第一段", "第二段", "第三段"])
    const result = extractTextFromBuffer(docx, "docx", "test.docx")
    expect(result.truncated).toBe(false)
    expect(result.text).toContain("第一段")
    expect(result.text).toContain("第二段")
    expect(result.text).toContain("第三段")
  })

  test("F7b: docx 单段落 → 返回文本", () => {
    const docx = makeMinimalDocx(["只有一段文字"])
    const result = extractTextFromBuffer(docx, "docx", "single.docx")
    expect(result.text).toContain("只有一段文字")
  })

  test("F7c: 损坏的 zip → 不抛,返回友好错误", () => {
    const buf = new TextEncoder().encode("not a zip file")
    const result = extractTextFromBuffer(buf, "docx", "broken.docx")
    expect(result.truncated).toBe(false)
    expect(result.text).toContain("docx 解析失败")
  })

  test("F7d: 空 word/document.xml → 返回空内容提示", () => {
    const xmlBytes = new TextEncoder().encode(
      `<w:document><w:body></w:body></w:document>`,
    )
    const docx = zipSync({ "word/document.xml": xmlBytes })
    const result = extractTextFromBuffer(docx, "docx", "empty.docx")
    expect(result.text).toContain("空")
  })
})

// ============================================================
// stripDocxXml 辅助测试
// ============================================================

describe("stripDocxXml", () => {
  test("基本 w:t 提取", () => {
    const xml =
      `<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>World</w:t></w:r></w:p></w:body></w:document>`
    const text = stripDocxXml(xml)
    expect(text).toContain("Hello")
    expect(text).toContain("World")
  })

  test("XML 实体解码 &amp; &lt;", () => {
    const xml = `<w:document><w:body><w:p><w:r><w:t>a &amp; b &lt; c</w:t></w:r></w:p></w:body></w:document>`
    const text = stripDocxXml(xml)
    expect(text).toContain("a & b < c")
  })

  test("空段落不加入 lines", () => {
    const xml = `<w:document><w:body><w:p></w:p><w:p><w:r><w:t>real</w:t></w:r></w:p></w:body></w:document>`
    const text = stripDocxXml(xml)
    expect(text.trim()).toBe("real")
  })
})
