// FORK-ONLY: actual native reader + browser renderer, no real Electron transport [feat: daily-file-links] 2026-11-14
import { expect, test, type Page } from "@playwright/test"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { readDocumentPreview } from "../../../desktop/src/main/deskfox/document-preview"
import { mockOpenCodeServer } from "../utils/mock-server"

test.use({ viewport: { width: 1440, height: 900 } })

async function bootstrap(page: Page, file: string, scope = "local", fragment = "") {
  const reads: string[] = []
  await mockOpenCodeServer(page, { directory: "/test/project", provider: { all: [], connected: [], default: {} }, project: { id: "preview", worktree: "/test/project", time: { created: 0 } }, sessions: [], pageMessages: () => ({ items: [] }) })
  await page.exposeFunction("previewRead", (input: { path: string }) => {
    reads.push(input.path)
    return readDocumentPreview(input)
  })
  await page.addInitScript(() => {
    Object.defineProperty(window, "deskfox", {
      value: {
        invoke: (command: string, args: { path: string }) =>
          command === "read_document_preview"
            ? (window as unknown as { previewRead: (input: { path: string }) => Promise<unknown> }).previewRead(args)
            : Promise.reject(new Error(`Unsupported fixture: ${command}`)),
        listen: async () => () => {},
      },
    })
  })
  await page.goto(`/e2e/fixtures/document-preview/index.html?${new URLSearchParams({ path: file, scope, fragment })}`)
  await expect(page.getByText("Global server: sidecar", { exact: true })).toBeVisible()
  return reads
}

test("opens an outside Markdown file internally, follows its encoded relative link and treats HTML as text", async ({
  page,
}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskfox-preview-gui-"))
  try {
    const file = path.join(root, "报告 draft.md")
    await writeFile(
      file,
      [
        "# Start",
        ...Array.from({ length: 35 }, (_, i) => `Paragraph ${i}.`),
        "## Target",
        "Outside file contents.",
        '<div style="background-image:url(localasset://localhost/L3RtcA/proof.png)">Resource probe</div>',
        '<img src="http://127.0.0.1:4331/proof.png" srcset="localasset://localhost/L3RtcA/proof.png 2x"><video poster="localasset://localhost/L3RtcA/proof.png"></video><svg><image href="localasset://localhost/L3RtcA/proof.png" /></svg>',
        "[HTML document](./safe%20page.html)",
      ].join("\n\n"),
    )
    const resources: string[] = []
    page.on("request", (request) => {
      if (request.url().includes("proof.png")) resources.push(request.url())
    })
    await writeFile(
      path.join(root, "safe page.html"),
      "<script>window.__executed = true</script><h1>Raw HTML file</h1>",
    )
    const reads = await bootstrap(page, file, "local", "target")
    await page.getByRole("button", { name: "Open artifact" }).click()
    const preview = page.locator('[data-component="document-preview"]')
    await expect(preview.getByText("Outside file contents.", { exact: true })).toBeVisible()
    await expect(preview.getByRole("heading", { name: "Target", exact: true })).toBeInViewport()
    await expect(preview.getByText("Resource probe", { exact: true })).toBeVisible()
    await expect(preview.locator("img, video, svg, [style], [src], [srcset], [poster]")).toHaveCount(0)
    expect(resources).toEqual([])
    await preview.getByRole("link", { name: "HTML document", exact: true }).click()
    await expect(preview.locator("pre")).toContainText("<script>window.__executed = true</script>")
    expect(await page.evaluate(() => "__executed" in window)).toBe(false)
    expect(reads).toEqual([file, await realpath(path.join(root, "safe page.html"))])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

for (const scope of ["remote", "wsl"]) {
  test(`global local server with scoped ${scope} never reads a local same-name file`, async ({ page }) => {
    const reads = await bootstrap(page, "/Users/name/Downloads/report.md", scope)
    await page.getByRole("button", { name: "Open artifact" }).click()
    await expect(page.getByRole("alert")).toContainText("不会打开远程电脑或 WSL 路径的本机同名文件")
    await expect(page.locator('[data-component="document-preview"]')).toHaveCount(0)
    expect(reads).toEqual([])
  })
}

test("renders the actual outside PDF page and reports Office conversion failure", async ({ page }) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskfox-preview-pdf-"))
  try {
    const file = path.join(root, "report.pdf")
    const stream = "BT /F1 18 Tf 40 180 Td (Outside PDF contents) Tj ET"
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ]
    let pdf = "%PDF-1.4\n"
    const offsets = objects.map((object, index) => {
      const offset = pdf.length
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
      return offset
    })
    const start = pdf.length
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
    await writeFile(file, pdf)
    await bootstrap(page, file)
    await page.getByRole("button", { name: "Open artifact" }).click()
    const preview = page.locator('[data-component="document-preview"]')
    await expect(preview.locator("canvas")).toBeVisible()
    await expect(preview.locator(".textLayer")).toContainText("Outside PDF contents")

    const office = path.join(root, "report.docx")
    await writeFile(office, "fixture: conversion should fail")
    await page.route("**/file/office-pdf?**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Fixture conversion unavailable" }),
      }),
    )
    await page.goto(`/e2e/fixtures/document-preview/index.html?${new URLSearchParams({ path: office })}`)
    await page.getByRole("button", { name: "Open artifact" }).click()
    await expect(preview.getByRole("alert")).toContainText("文档转换失败")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
