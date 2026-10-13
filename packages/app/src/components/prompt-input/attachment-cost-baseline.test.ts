// [fork-only] C0 characterization; replace PDF/path assertions when implementing C2.
import { expect, test } from "bun:test"
import { attachmentMime } from "./files"
import { routeExternalDrop } from "./external-drop"

test("normalized attachment routing preserves PDF and rejects Office before routing", async () => {
  const cases = [
    { name: "table.csv", type: "text/csv", data: "a,b\n1,2", mime: "text/plain", path: true },
    { name: "notes.txt", type: "", data: "plain text", mime: "text/plain", path: true },
    { name: "manual.pdf", type: "application/pdf", data: "%PDF-1.7", mime: "application/pdf", path: false },
    { name: "photo.png", type: "image/png", data: "image fixture", mime: "image/png", path: false },
    { name: "office.docx", type: "application/octet-stream", data: "PK\u0000\u0001", mime: undefined, path: false },
  ]
  for (const item of cases) {
    expect(await attachmentMime(new File([item.data], item.name, { type: item.type }))).toBe(item.mime)
    expect(routeExternalDrop({ type: item.mime, local: true, name: item.name, path: `/tmp/${item.name}` }).kind).toBe(
      item.path ? "path" : "inline",
    )
    expect(routeExternalDrop({ type: item.type, name: item.name }).kind).toBe("inline")
  }
  console.log(
    JSON.stringify({
      probe: "C0-routing",
      cases: cases.map(({ name, mime, path }) => ({
        name,
        mime: mime ?? "rejected",
        externalRoute: path ? "path" : "inline",
      })),
    }),
  )
})
