// FORK-ONLY: DeskFox 原生文件操作 [feat: electron-replatform] 2026-06-12
//
// 从 Tauri lib.rs / text_file.rs 平移到 Electron 主进程(Node fs + electron shell)。
// 由 main/deskfox/ipc.ts 经 ipcMain.handle("deskfox:<cmd>") 暴露给 renderer 的 window.deskfox 桥。
// 命令参数/返回与原 Tauri #[command] 契约一致(见 app/src/utils/native.ts 调用点)。

import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import { shell } from "electron"

/** resolve(root, path):root 非空则 join,root 空则 path 视为绝对(对齐 Rust resolve)。 */
function resolve(root: string, p: string): string {
  return root ? path.resolve(root, p) : p
}

/** 仅在最后一个 `.` 之后切;开头 `.` 不算扩展名(.gitignore)。对齐 Rust split_name_ext。 */
function splitNameExt(name: string): [string, string] {
  const idx = name.lastIndexOf(".")
  if (idx > 0 && idx < name.length - 1) return [name.slice(0, idx), name.slice(idx)]
  return [name, ""]
}

export async function copyPath(args: { from: string; to: string }): Promise<void> {
  await fs.cp(args.from, args.to, { recursive: true, errorOnExist: true, force: false })
}

export async function createDirectory(args: { path: string }): Promise<void> {
  await fs.mkdir(args.path, { recursive: false })
}

export async function createEmptyFile(args: { path: string }): Promise<void> {
  // wx:不覆盖已存在
  const fh = await fs.open(args.path, "wx")
  await fh.close()
}

export function nextAvailablePath(args: { dir: string; name: string }): string {
  const initial = path.join(args.dir, args.name)
  if (!fsSync.existsSync(initial)) return initial
  const [base, ext] = splitNameExt(args.name)
  for (let i = 1; i <= 1000; i++) {
    const candidate = path.join(args.dir, `${base}-${i}${ext}`)
    if (!fsSync.existsSync(candidate)) return candidate
  }
  return initial
}

export async function renamePath(args: { from: string; to: string }): Promise<void> {
  await fs.rename(args.from, args.to)
}

export async function trashPath(args: { path: string }): Promise<void> {
  // FORK: shell.trashItem 在 Windows 只认原生反斜杠路径,传 forward slash 报 "Failed to parse path"
  //   → path.resolve 归一成 OS 原生分隔符。再先 stat,不存在给可理解错误(典型:UI 陈旧条目)。
  //   [bug-repro: 删除报 trash_path Failed to parse path] 2026-06-13
  const native = path.resolve(args.path)
  try {
    await fs.stat(native)
  } catch {
    throw new Error(`path not found(可能已被移动或删除): ${native}`)
  }
  await shell.trashItem(native)
}

export async function openPath(args: { path: string; appName: string | null }): Promise<void> {
  // appName 暂忽略(默认应用打开);Rust 版支持指定 app,后续按需补 OPEN_APPS 映射
  const err = await shell.openPath(args.path)
  if (err) throw new Error(`open failed: ${args.path}: ${err}`)
}

export function revealInFolder(args: { path: string }): void {
  shell.showItemInFolder(args.path)
}

export async function getFileMtime(args: { root: string; path: string }): Promise<number> {
  const st = await fs.stat(resolve(args.root, args.path))
  return Math.floor(st.mtimeMs)
}

export async function getFileSize(args: { root: string; path: string }): Promise<number> {
  const full = resolve(args.root, args.path)
  const st = await fs.stat(full)
  if (!st.isFile()) throw new Error(`not a file: ${full}`)
  return st.size
}

export async function writeTextFile(args: {
  root: string
  path: string
  content: string
  expectedMtime?: number | null
}): Promise<number> {
  const full = resolve(args.root, args.path)
  // readonly + mtime 冲突检测(文件不存在则跳过)
  try {
    const st = await fs.stat(full)
    if (st.isFile()) {
      // @ts-ignore mode readonly 判断(Win 上 stat 的 mode 不完全可靠,尽力而为)
      if (process.platform !== "win32" && (st.mode & 0o200) === 0) throw new Error(`readonly: ${full}`)
      if (args.expectedMtime != null && Math.floor(st.mtimeMs) !== args.expectedMtime) {
        throw new Error(`mtime-conflict: ${full}`)
      }
    }
  } catch (e: any) {
    if (e?.code !== "ENOENT") throw e
  }
  await fs.writeFile(full, args.content, "utf-8")
  const st = await fs.stat(full)
  return Math.floor(st.mtimeMs)
}

export async function readBinaryFileBase64(args: { root: string; path: string }): Promise<string> {
  const buf = await fs.readFile(resolve(args.root, args.path))
  return buf.toString("base64")
}

export async function writeBinaryFileAbsoluteBase64(args: {
  path: string
  base64Content: string
  allowOverwrite?: boolean
}): Promise<void> {
  const buf = Buffer.from(args.base64Content, "base64")
  if (!args.allowOverwrite && fsSync.existsSync(args.path)) throw new Error(`already-exists: ${args.path}`)
  await fs.writeFile(args.path, buf)
}

const FETCH_MAX_BYTES = 8 * 1024 * 1024 // 8MB(对齐 Rust)
export async function fetchUrlBase64(args: { url: string }): Promise<string> {
  if (!/^https?:\/\//i.test(args.url)) throw new Error(`unsupported scheme: ${args.url}`)
  const res = await fetch(args.url)
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`)
  const ab = await res.arrayBuffer()
  if (ab.byteLength > FETCH_MAX_BYTES) throw new Error(`too large: ${ab.byteLength} bytes`)
  return Buffer.from(ab).toString("base64")
}
