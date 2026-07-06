// FORK-ONLY: win-anchor-hide-case-fold — sameDirectory 大小写折叠单测 2026-07-07
import { describe, expect, test } from "bun:test"
import { sameDirectory, sameDirectoryKey } from "./same-directory"

describe("sameDirectory", () => {
  // TC-C1:Windows 盘符大小写不同 → 判等(NTFS 大小写不敏感)
  test("TC-C1: windows drive-letter/case differences are equal", () => {
    expect(sameDirectory("D:\\Foo", "d:\\foo")).toBe(true)
    expect(sameDirectory("D:\\Foo\\Bar", "d:\\FOO\\bar")).toBe(true)
  })

  // TC-C2:分隔符不同(\ vs /)→ 判等(复用 pathKey 归一)
  test("TC-C2: windows separator differences are equal", () => {
    expect(sameDirectory("D:\\Foo\\Bar", "D:/Foo/Bar")).toBe(true)
    expect(sameDirectory("D:\\Foo\\Bar", "d:/foo/bar")).toBe(true)
  })

  // TC-C3:POSIX 路径大小写不同 → 不判等(大小写敏感 FS,不误折叠 → Mac/Linux 零回归)
  test("TC-C3: posix case differences are NOT equal", () => {
    expect(sameDirectory("/Foo", "/foo")).toBe(false)
    expect(sameDirectory("/home/User/Proj", "/home/user/proj")).toBe(false)
  })

  // TC-C4:真不同目录 → 不判等
  test("TC-C4: genuinely different dirs are not equal", () => {
    expect(sameDirectory("D:\\Foo", "D:\\Bar")).toBe(false)
    expect(sameDirectory("/home/a", "/home/b")).toBe(false)
  })

  // TC-C5:UNC 路径大小写不同 → 判等
  test("TC-C5: UNC path case differences are equal", () => {
    expect(sameDirectory("\\\\Srv\\Share\\Proj", "\\\\srv\\share\\proj")).toBe(true)
    expect(sameDirectory("\\\\Srv\\Share", "\\\\srv\\SHARE")).toBe(true)
  })

  test("identical posix paths are equal (no regression)", () => {
    expect(sameDirectory("/home/user/proj", "/home/user/proj")).toBe(true)
  })

  test("trailing slash normalized via pathKey", () => {
    expect(sameDirectory("D:\\Foo\\", "d:\\foo")).toBe(true)
    expect(sameDirectory("/home/user/", "/home/user")).toBe(true)
  })

  test("sameDirectoryKey folds windows, preserves posix case", () => {
    expect(sameDirectoryKey("D:\\Foo") as string).toBe("d:/foo")
    expect(sameDirectoryKey("/Foo/Bar") as string).toBe("/Foo/Bar")
  })
})
