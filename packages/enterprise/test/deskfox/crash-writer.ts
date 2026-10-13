import { createFileStore } from "../../src/deskfox/file-store"

const store = await createFileStore(process.argv[2]!, 0)
await store.write("a".repeat(48), JSON.stringify({ text: "x".repeat(32 * 1024 * 1024) }))
// Keep the writer alive if rename beats the observer; either complete version is valid.
await new Promise(() => {})
