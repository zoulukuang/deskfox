// [fork-only] media-gen — 生成结果落盘到本地分类文件夹(创作文件库)
// [feat: media-creation-mode] 2026-05-27
//
// OSS 链接 24h 过期,且 user 要"分门别类存放 + 右侧文件夹浏览"。生成后把文件下载到
// ~/.deskfox/creations/<images|videos|audio>/,返回本地路径供聊天提示 + 右侧面板用。

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { extname, join } from "node:path"

// 落盘根目录:有项目目录则放该项目根下的 creations/(user 要求"产出放在当前项目根目录下"),
// 否则回落到全局 ~/.deskfox/creations/。
const GLOBAL_ROOT = join(homedir(), ".deskfox", "creations")
export function creationsRoot(projectDir?: string): string {
  return projectDir && projectDir.trim() ? join(projectDir, "creations") : GLOBAL_ROOT
}

const SUBDIR: Record<string, string> = { image: "images", video: "videos", audio: "audio" }
const DEFAULT_EXT: Record<string, string> = { image: "png", video: "mp4", audio: "wav" }

function categoryDir(projectDir: string | undefined, kind: string): string {
  return join(creationsRoot(projectDir), SUBDIR[kind] ?? "other")
}

function guessExt(url: string, kind: string): string {
  const m = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(url)
  return (m?.[1] ?? DEFAULT_EXT[kind] ?? "bin").toLowerCase()
}

/** 把若干 URL 下载到分类目录(projectDir 为当前项目根,缺省则全局),返回本地绝对路径 */
export async function saveAssets(
  projectDir: string | undefined,
  kind: "image" | "video" | "audio",
  urls: string[],
): Promise<string[]> {
  const dir = categoryDir(projectDir, kind)
  mkdirSync(dir, { recursive: true })
  const out: string[] = []
  for (const url of urls) {
    try {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${guessExt(url, kind)}`
      const p = join(dir, name)
      writeFileSync(p, bytes)
      out.push(p)
    } catch {
      /* 单个下载失败不阻断其余 */
    }
  }
  return out
}

export type CreationFile = { path: string; name: string; kind: string; mtime: number; size: number }

/** 列出创作文件库(供右侧"创作文件"面板;projectDir 为当前项目根)*/
export function listCreations(projectDir?: string): { images: CreationFile[]; videos: CreationFile[]; audio: CreationFile[] } {
  const read = (kind: "image" | "video" | "audio"): CreationFile[] => {
    const dir = categoryDir(projectDir, kind)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((n) => !n.startsWith("."))
      .map((n) => {
        const p = join(dir, n)
        const st = statSync(p)
        return { path: p, name: n, kind, mtime: st.mtimeMs, size: st.size, ext: extname(n) }
      })
      .sort((a, b) => b.mtime - a.mtime)
  }
  return { images: read("image"), videos: read("video"), audio: read("audio") }
}
