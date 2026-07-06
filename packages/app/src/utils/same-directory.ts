// FORK-ONLY: win-anchor-hide-case-fold — Windows 大小写不敏感的目录身份比较 2026-07-07
//
// 起源:REQ-072 改名 relocate 链用裸 `project.worktree === directory` 比对。Windows 文件系统
// 大小写不敏感(C:\Foo == c:\foo),但 JS `===` 敏感 → 持久化 worktree(历史值/深链/用户手输,
// 大小写不受控)与后端 realpath 规范化的 worktree 差一位即 findIndex=-1 → relocate 静默失效 →
// 退回「打不开 + forget」。
//
// 设计:
//  - 复用上游 pathKey(已归一 \→/ 与盘符),再对「Windows 风格路径」(盘符 / UNC)折叠小写。
//  - POSIX 路径(大小写敏感 FS)**不折叠** → Mac/Linux 行为与裸 pathKey bit-identical(零回归)。
//  - 按路径「形态」而非运行时 OS 判定:Windows 风格路径无论在哪比较都该大小写不敏感,
//    也让单测跨平台稳定(不依赖 process.platform)。
//  - **不动上游 pathKey**:其输出经 sdkFor→createClient({directory}) 发后端,小写化会改线上协议。
import { pathKey, type PathKey } from "./path-key"

/** pathKey 归一后是否 Windows 风格(盘符 X: 或 UNC //)。 */
const isWindowsKey = (key: string) => /^[a-zA-Z]:/.test(key) || key.startsWith("//")

/** 目录身份 key:Windows 风格折叠小写,POSIX 原样。用于大小写不敏感的目录匹配/去重。 */
export const sameDirectoryKey = (dir: string): PathKey => {
  const key = pathKey(dir)
  return (isWindowsKey(key) ? key.toLowerCase() : key) as PathKey
}

/** 两个目录是否同一身份(Windows 大小写不敏感;POSIX 大小写敏感)。 */
export const sameDirectory = (a: string, b: string): boolean => sameDirectoryKey(a) === sameDirectoryKey(b)
