import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import { createRepository } from "../../src/deskfox/repository"

// Fault injection is confined to a disposable Node process. The parent uses unmodified
// filesystem APIs and reopens the actual repository after each injected failure.
const [directory, id, secret, boundary, behavior] = process.argv.slice(2)
const original = { open: fs.promises.open, rename: fs.promises.rename }
const state = { hit: false }
const fault = () => {
  state.hit = true
  if (behavior === "kill") {
    fs.writeSync(1, `fault:${boundary}\n`)
    process.kill(process.pid, "SIGKILL")
  }
  throw new Error(`injected-${boundary}`)
}
fs.promises.open = async (...args) => {
  const handle = await original.open(...args)
  const temporary = String(args[0]).endsWith(".tmp")
  const parent = String(args[0]) === directory
  return new Proxy(handle, {
    get(target, key) {
      if (temporary && key === "writeFile" && boundary === "write")
        return async (...input: Parameters<typeof handle.writeFile>) => {
          if (behavior === "kill") {
            await target.writeFile(...input)
            return fault()
          }
          await target.writeFile('{"version":')
          return fault()
        }
      if (key === "sync" && ((temporary && boundary === "file-sync") || (parent && boundary === "directory-sync")))
        return async () => {
          if (behavior === "kill") await target.sync()
          return fault()
        }
      const value = Reflect.get(target, key, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
fs.promises.rename = async (...args) => {
  if (boundary !== "rename") return original.rename(...args)
  if (behavior === "kill") await original.rename(...args)
  return fault()
}
syncBuiltinESMExports()

const repository = await createRepository({ directory, maxBytes: 1024 * 1024, minimumFreeBytes: 0 })
const outcome = await repository.remove({ id, secret }).then(
  () => "unexpected-success",
  (error: unknown) => (error instanceof Error ? error.message : "unexpected-error"),
)
console.log(JSON.stringify({ hit: state.hit, outcome }))
process.exit(state.hit && outcome === `injected-${boundary}` ? 0 : 1)
