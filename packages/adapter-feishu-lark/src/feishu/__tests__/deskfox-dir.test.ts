// [feat: feishu-account-workspace] 2026-06-07
// `_deskfox/` 目录 + .gitignore 维护单测(T6/T7)

import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DESKFOX_DIR_NAME,
  deskfoxFeishuFilesDir,
  deskfoxFeishuImagesDir,
  ensureDeskfoxDir,
} from "../deskfox-dir"

function tmpWs(): string {
  return mkdtempSync(join(tmpdir(), "deskfox-dir-test-"))
}

const realIo = { existsSync, mkdirSync, readFileSync, writeFileSync }
const silent = { warn: () => {} }

describe("deskfox-dir 路径 helper", () => {
  test("路径常量按 IM 分子目录", () => {
    const ws = "/some/project"
    expect(deskfoxFeishuFilesDir(ws)).toBe(join(ws, "_deskfox", "feishu", "files"))
    expect(deskfoxFeishuImagesDir(ws)).toBe(join(ws, "_deskfox", "feishu", "images"))
    expect(DESKFOX_DIR_NAME).toBe("_deskfox")
  })
})

describe("ensureDeskfoxDir (T6/T7)", () => {
  test("T6a: 空项目 → 建 _deskfox/ + .gitignore 含 _deskfox/", () => {
    const ws = tmpWs()
    ensureDeskfoxDir(ws, realIo, silent)
    expect(existsSync(join(ws, "_deskfox"))).toBe(true)
    const gi = readFileSync(join(ws, ".gitignore"), "utf-8")
    expect(gi.split(/\r?\n/)).toContain("_deskfox/")
  })

  test("T6b: 已有 .gitignore 不含 → 追加一行,保留原内容", () => {
    const ws = tmpWs()
    writeFileSync(join(ws, ".gitignore"), "node_modules/\ndist/\n", "utf-8")
    ensureDeskfoxDir(ws, realIo, silent)
    const gi = readFileSync(join(ws, ".gitignore"), "utf-8")
    expect(gi).toContain("node_modules/")
    expect(gi).toContain("dist/")
    expect(gi.split(/\r?\n/)).toContain("_deskfox/")
  })

  test("T6c: 已含 _deskfox/ → 幂等,不重复追加", () => {
    const ws = tmpWs()
    writeFileSync(join(ws, ".gitignore"), "_deskfox/\nfoo/\n", "utf-8")
    ensureDeskfoxDir(ws, realIo, silent)
    ensureDeskfoxDir(ws, realIo, silent)
    const gi = readFileSync(join(ws, ".gitignore"), "utf-8")
    const count = gi.split(/\r?\n/).filter((l) => l.trim() === "_deskfox/").length
    expect(count).toBe(1)
  })

  test("T6d: 已含无斜杠形式 _deskfox → 视为已存在,不重复", () => {
    const ws = tmpWs()
    writeFileSync(join(ws, ".gitignore"), "_deskfox\n", "utf-8")
    ensureDeskfoxDir(ws, realIo, silent)
    const gi = readFileSync(join(ws, ".gitignore"), "utf-8")
    // 不追加 `_deskfox/`(已有 `_deskfox` 行覆盖语义)
    expect(gi.split(/\r?\n/).filter((l) => l.trim().startsWith("_deskfox")).length).toBe(1)
  })

  test("T7: 已有 .gitignore 末尾无换行 → 追加前补换行,不粘连原最后一行", () => {
    const ws = tmpWs()
    writeFileSync(join(ws, ".gitignore"), "dist/", "utf-8") // 无尾换行
    ensureDeskfoxDir(ws, realIo, silent)
    const gi = readFileSync(join(ws, ".gitignore"), "utf-8")
    expect(gi).not.toContain("dist/_deskfox")
    const lines = gi.split(/\r?\n/)
    expect(lines).toContain("dist/")
    expect(lines).toContain("_deskfox/")
  })

  test("fs 失败只 warn 不抛(best-effort)", () => {
    const ws = tmpWs()
    const throwingIo = {
      existsSync,
      mkdirSync,
      readFileSync,
      writeFileSync: () => {
        throw new Error("disk full")
      },
    }
    let warned = false
    expect(() =>
      ensureDeskfoxDir(ws, throwingIo, { warn: () => (warned = true) }),
    ).not.toThrow()
    expect(warned).toBe(true)
  })
})
