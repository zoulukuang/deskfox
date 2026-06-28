// FORK: REQ-067 — 大小写路径防御兜底单测(平台无关,Windows CI 可跑)[feat: stale-path-hardening]
import { test, expect } from "bun:test"
import ignore from "ignore"
import path from "path"
import {
  ignoreRelativePath,
  safeIgnores,
} from "../../src/server/routes/instance/httpapi/handlers/ignore-path"

// 复现 macOS 崩点:大写规范 base + 小写 raw child(大小写不敏感卷),posix path.relative 产 "../x/.git"
const POSIX_BASE = "/project/Deskfox-plugins"
const POSIX_CHILD_GIT = "/project/deskfox-plugins/.git"

test("posix path.relative 对大小写不一致前缀确实产出 .. 逃逸(崩点前提)", () => {
  const rel = path.posix.relative(POSIX_BASE, POSIX_CHILD_GIT)
  expect(rel.startsWith("..")).toBe(true)
  // 原行为:这个字符串喂给 ignore 会抛 RangeError
  expect(() => ignore().add(".git").ignores(rel)).toThrow()
})

test("ignoreRelativePath 归一大小写前缀,返回干净 tail(.git 不带 ..)", () => {
  const rel = ignoreRelativePath(POSIX_BASE, POSIX_CHILD_GIT)
  expect(rel).toBe(".git")
  expect(rel.startsWith("..")).toBe(false)
})

test("归一后 .git 仍被 ignore 命中(不泄漏进文件树),且不抛 RangeError", () => {
  const ig = ignore().add(".git").add("node_modules")
  const rel = ignoreRelativePath(POSIX_BASE, POSIX_CHILD_GIT)
  expect(() => safeIgnores(ig, rel)).not.toThrow()
  expect(safeIgnores(ig, rel)).toBe(true)
})

test("node_modules 同样仍被命中", () => {
  const ig = ignore().add("node_modules")
  const rel = ignoreRelativePath(POSIX_BASE, "/project/deskfox-plugins/node_modules")
  expect(rel).toBe("node_modules")
  expect(safeIgnores(ig, rel + "/")).toBe(true)
})

test("正常大小写一致路径行为不变", () => {
  const rel = ignoreRelativePath(POSIX_BASE, "/project/Deskfox-plugins/src/index.ts")
  expect(rel).toBe(path.join("src", "index.ts"))
})

test("多层 tail 保留原始大小写", () => {
  const rel = ignoreRelativePath(POSIX_BASE, "/project/deskfox-plugins/Src/Foo.TS")
  expect(rel).toBe(path.join("Src", "Foo.TS"))
})

test("safeIgnores 对真逃逸路径(软链接指仓库外)不抛,降级为不忽略", () => {
  const ig = ignore().add(".git")
  // 真逃逸:target 完全不在 base 内 → ignoreRelativePath 原样返回带 .. 的相对路径
  const rel = ignoreRelativePath(POSIX_BASE, "/elsewhere/secret/.git")
  expect(rel.startsWith("..")).toBe(true)
  expect(() => safeIgnores(ig, rel)).not.toThrow()
  expect(safeIgnores(ig, rel)).toBe(false)
})

test("safeIgnores 直接喂 .. 字符串也不崩", () => {
  const ig = ignore().add(".git")
  expect(() => safeIgnores(ig, "../x/.git")).not.toThrow()
  expect(safeIgnores(ig, "../x/.git")).toBe(false)
})

// [bug-repro: Windows 跨盘符/UNC 绝对路径喂 ignore@7 抛 RangeError 被吞 → 降级不忽略 → .git/node_modules 泄漏进文件树]
// 旧 safeIgnores 只防 "..";Windows subst/junction 同仓库经另一盘符时 path.win32.relative 产绝对路径(无 ".."),
// 直落 ig.ignores() → RangeError → catch → false(泄漏)。修后退用末段 basename 兜按名忽略。
test("safeIgnores 对 Windows 跨盘符绝对路径不崩,且 .git 仍按 basename 命中(不泄漏)", () => {
  const ig = ignore().add(".git").add("node_modules")
  expect(() => safeIgnores(ig, "D:\\other\\.git")).not.toThrow()
  expect(safeIgnores(ig, "D:\\other\\.git")).toBe(true)
})

test("safeIgnores 对 Windows 跨盘符绝对目录路径(尾斜杠)命中 node_modules", () => {
  const ig = ignore().add("node_modules")
  expect(safeIgnores(ig, "D:\\other\\sub\\node_modules\\")).toBe(true)
  expect(safeIgnores(ig, "D:\\other\\sub\\node_modules/")).toBe(true)
})

test("safeIgnores 对 Windows 跨盘符绝对路径下未命中规则的普通文件 → 不忽略", () => {
  const ig = ignore().add(".git")
  expect(safeIgnores(ig, "D:\\other\\src\\index.ts")).toBe(false)
})

test("safeIgnores 对 UNC 绝对路径(\\\\server\\share)不崩,按 basename 判定", () => {
  const ig = ignore().add(".git")
  expect(() => safeIgnores(ig, "\\\\server\\share\\proj\\.git")).not.toThrow()
  expect(safeIgnores(ig, "\\\\server\\share\\proj\\.git")).toBe(true)
})
