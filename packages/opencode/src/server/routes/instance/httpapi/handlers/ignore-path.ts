// FORK: REQ-067 — 路径大小写不一致防御兜底(护 macOS 发布版)。2026-06-25
// 上游 file.ts 在 .gitignore 匹配时用 path.relative(项目根, 文件绝对路径)。当「打开时的 raw 路径」
// 与「git toplevel 规范路径」仅大小写不同(大小写不敏感卷:macOS/Windows),posix 的 path.relative
// 大小写敏感 → 产出 "../<dir>/.git" 这种以 ".." 开头的逃逸路径 → 喂给 ignore@7 的 checkPath 抛
// RangeError → 整个 /file 列表 500(REQ-067)。
//   - Windows(path.win32.relative 大小写不敏感)实测不触发,故此为 mac-only 防御;
//   - 本文件纯字符串逻辑、与 OS 无关 → 平台无关单测可在 Windows CI 跑(见 ignore-path.test.ts)。
// 修法两层:① ignoreRelativePath 把仅大小写/分隔符不同的前缀归一(保留 tail 原始大小写,使
// .git / node_modules 仍命中 ignore、不泄漏);② safeIgnores 兜住任何残留 ".."(真逃逸:软链/junction
// 指到项目外)不再 500,降级为「不忽略」。

import path from "path"

function splitSegments(p: string): string[] {
  return p.split(/[\\/]+/).filter(Boolean)
}

/**
 * 计算用于 .gitignore 匹配的「仓库相对路径」,防御 base(项目根,规范大写)与 target(文件绝对路径,
 * 经 raw location.directory resolve 出来)仅因大小写/分隔符不同而被 path.relative 判成 ".." 逃逸。
 *
 * - 正常情况(target 在 base 之内,大小写一致):直接返回 path.relative 结果。
 * - target 仅因大小写/分隔符与 base 前缀不同(大小写不敏感卷上 target 实际在 base 内):
 *   按段大小写不敏感剥掉 base 前缀,返回 tail(保留 target 原始大小写)→ .git / node_modules 仍精确命中。
 * - 真正的逃逸(target 不在 base 内,如软链接指向仓库外):原样返回带 ".." 的相对路径,
 *   由 safeIgnores 兜底防 ignore 抛错。
 */
export function ignoreRelativePath(base: string, target: string): string {
  const rel = path.relative(base, target)
  if (!rel.startsWith("..")) return rel

  const baseSegments = splitSegments(base)
  const targetSegments = splitSegments(target)
  let i = 0
  while (
    i < baseSegments.length &&
    i < targetSegments.length &&
    baseSegments[i].toLowerCase() === targetSegments[i].toLowerCase()
  )
    i++

  // base 的所有段都被 target 前缀(大小写不敏感)命中 → target 实际在 base 内,返回 tail
  if (i === baseSegments.length) return targetSegments.slice(i).join(path.sep)

  // 真逃逸:target 不在 base 内 → 原样返回(交给 safeIgnores 兜底)
  return rel
}

/**
 * 安全调用 ignore 实例的 ignores():ignore@7 对以 ".." 开头的路径(checkPath)抛 RangeError。
 * 任何残留 ".." 逃逸路径都不应让 /file 列表 500 → 出现时降级为「不忽略」(返回 false)而非崩溃。
 */
export function safeIgnores(ig: { ignores(p: string): boolean }, p: string): boolean {
  if (p.startsWith("..")) return false
  try {
    return ig.ignores(p)
  } catch {
    return false
  }
}
