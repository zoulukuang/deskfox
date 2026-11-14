import path from "node:path"
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import { applyEdits, modify } from "jsonc-parser"
import { Flock } from "@opencode-ai/core/util/flock"
import { ConfigParse } from "./parse"
import { isRecord } from "../util/record"

// Reapply only the project switch leaves after Desktop's automatic local defaults.
// All other directory settings retain upstream precedence; env/managed policy loads later.
export function mcpEnabledOverrides(config: unknown) {
  const mcp = isRecord(config) && isRecord(config.mcp) ? config.mcp : {}
  return {
    mcp: Object.fromEntries(
      Object.entries(mcp).flatMap(([name, value]) =>
        isRecord(value) && typeof value.enabled === "boolean" ? [[name, { enabled: value.enabled }]] : [],
      ),
    ),
  }
}

// Project overrides use the existing ConfigV1 merge contract, not a second state store.
export async function saveMcpEnabled(directory: string, name: string, enabled: boolean) {
  const root = await realpath(directory)
  const folder = path.join(root, ".opencode")
  await mkdir(folder, { recursive: true })
  if ((await realpath(folder)) !== folder)
    throw new Error("MCP settings directory must stay inside the current project")
  const file = path.join(folder, "opencode.jsonc")
  await Flock.withLock(
    `mcp-toggle:${file}`,
    async () => {
      const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      if (stat?.isSymbolicLink()) throw new Error("MCP settings cannot overwrite a linked configuration file")
      if (stat && (stat.mode & 0o222) === 0) throw new Error("MCP settings file is read-only")
      const before = stat ? await readFile(file, "utf8") : "{}\n"
      const parsed = ConfigParse.jsonc(before, file)
      if (!isRecord(parsed) || (parsed.mcp !== undefined && !isRecord(parsed.mcp))) {
        throw new Error("MCP settings require an object configuration")
      }
      const after = applyEdits(
        before,
        modify(before, ["mcp", name, "enabled"], enabled, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }),
      )
      const temporary = `${file}.${crypto.randomUUID()}.tmp`
      try {
        await writeFile(temporary, after, { flag: "wx", mode: stat?.mode ?? 0o600 })
        await rename(temporary, file)
      } finally {
        await rm(temporary, { force: true })
      }
    },
    { timeoutMs: 2_000 },
  )
}
