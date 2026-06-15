// [fork-only] verify 链纯逻辑 Logic 清单单测(R5)[feat: verify-core-tests] 2026-06-15
//
// 覆盖 verify-core.ts 四个纯函数:probesFromChangedFiles / selectProbes / classifyVerdict / evaluateReleaseChecks。
// verify.ts(编排器)= IO/进程/CDP 外壳,不进 unit;其纯逻辑全在 verify-core,这里测。

import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  ALL_PROBES,
  type Probe,
  probesFromChangedFiles,
  selectProbes,
  classifyVerdict,
  evaluateReleaseChecks,
  type SmokeReport,
} from "../smoke/verify-core"

const ALL = [...ALL_PROBES]

// ── probesFromChangedFiles ──────────────────────────────────────────────────────
describe("probesFromChangedFiles — git 改动 → probe 映射", () => {
  test("无 desktop 改动 → 全量 + reason=no-desktop", () => {
    const r = probesFromChangedFiles(["packages/opencode/src/foo.ts", "docs/x.md"])
    expect(r.reason).toBe("no-desktop")
    expect(r.probes.sort()).toEqual([...ALL].sort())
  })

  test("空数组 → 全量(no-desktop)", () => {
    expect(probesFromChangedFiles([]).reason).toBe("no-desktop")
  })

  test("file-viewer / csv / pdf / office 渲染器文件 → files", () => {
    for (const f of [
      "packages/desktop/src/renderer/components/file-viewer/foo.tsx",
      "packages/desktop/src/renderer/csv-view.tsx",
      "packages/desktop/src/renderer/pdf/pdf.tsx",
      "packages/desktop/src/renderer/document-viewer/x.ts",
      "packages/desktop/src/renderer/office-install.tsx",
    ]) {
      expect(probesFromChangedFiles([f]).probes).toContain("files")
    }
  })

  test("provider 文件 → providers", () => {
    expect(probesFromChangedFiles(["packages/desktop/src/renderer/provider-list.tsx"]).probes).toContain("providers")
  })

  test("setting 文件 → settings", () => {
    expect(probesFromChangedFiles(["packages/desktop/src/renderer/settings-general.tsx"]).probes).toContain("settings")
  })

  test("titlebar / panel / sidebar → panels", () => {
    for (const f of [
      "packages/desktop/src/renderer/titlebar.tsx",
      "packages/desktop/src/renderer/side-panel.tsx",
      "packages/desktop/src/renderer/sidebar-workspace.tsx",
    ]) {
      expect(probesFromChangedFiles([f]).probes).toContain("panels")
    }
  })

  test("src/main / preload / startup / plugin → boot", () => {
    for (const f of [
      "packages/desktop/src/main/index.ts",
      "packages/desktop/src/preload.ts",
      "packages/desktop/src/renderer/startup-gate.tsx",
      "packages/desktop/src/main/plugin-install.ts",
    ]) {
      expect(probesFromChangedFiles([f]).probes).toContain("boot")
    }
  })

  test("desktop 有改动但不命中任何规则 → 全量(no-match,保守)", () => {
    const r = probesFromChangedFiles(["packages/desktop/src/renderer/totally-unrelated.tsx"])
    expect(r.reason).toBe("no-match")
    expect(r.probes.sort()).toEqual([...ALL].sort())
  })

  test("多文件命中多规则 → 取并集(去重)", () => {
    const r = probesFromChangedFiles([
      "packages/desktop/src/renderer/provider-list.tsx",
      "packages/desktop/src/renderer/settings-general.tsx",
      "packages/desktop/src/main/index.ts",
    ])
    expect(r.reason).toBe("matched")
    expect(r.probes.sort()).toEqual((["boot", "providers", "settings"] as Probe[]).sort())
  })
})

// ── selectProbes ────────────────────────────────────────────────────────────────
describe("selectProbes — 优先级 only > changed > scope > 全量", () => {
  test("--only 解析 + how", () => {
    expect(selectProbes({ only: "files,providers" })).toEqual({ probes: ["files", "providers"], how: "--only" })
  })

  test("--only 含未知 probe → throw", () => {
    expect(() => selectProbes({ only: "files,bogus" })).toThrow(/未知 probe/)
  })

  test("--changed → 用传入的 changedProbes", () => {
    expect(selectProbes({ changed: true, changedProbes: ["boot"] as Probe[] })).toEqual({ probes: ["boot"], how: "--changed" })
  })

  test("--scope 各档映射", () => {
    expect(selectProbes({ scope: "ui" }).probes.sort()).toEqual((["boot", "panels", "settings"] as Probe[]).sort())
    expect(selectProbes({ scope: "provider" }).probes).toEqual(["providers"])
    expect(selectProbes({ scope: "viewer" }).probes).toEqual(["files"])
    expect(selectProbes({ scope: "all" }).probes.sort()).toEqual([...ALL].sort())
  })

  test("--scope 未知 → throw", () => {
    expect(() => selectProbes({ scope: "nope" })).toThrow(/未知 scope/)
  })

  test("无 flag → 全量(默认)", () => {
    const r = selectProbes({})
    expect(r.how).toBe("全量(默认)")
    expect(r.probes.sort()).toEqual([...ALL].sort())
  })

  test("优先级:only 压过 changed/scope", () => {
    expect(selectProbes({ only: "boot", changed: true, changedProbes: ["files"] as Probe[], scope: "ui" }).how).toBe("--only")
  })

  test("优先级:changed 压过 scope", () => {
    expect(selectProbes({ changed: true, changedProbes: ["files"] as Probe[], scope: "ui" }).how).toBe("--changed")
  })
})

// ── classifyVerdict ─────────────────────────────────────────────────────────────
describe("classifyVerdict — 冒烟报告 → 退出码", () => {
  const mk = (statuses: string[]): SmokeReport => ({
    summary: {},
    results: statuses.map((status, i) => ({ group: "g", name: `t${i}`, status, detail: "" })),
  })

  test("有 crash → 1🔴(即使同时有 fail)", () => {
    expect(classifyVerdict(mk(["pass", "fail", "crash"])).code).toBe(1)
  })

  test("无 crash 有 fail → 2🟡", () => {
    expect(classifyVerdict(mk(["pass", "fail"])).code).toBe(2)
  })

  test("全过 → 0🟢", () => {
    expect(classifyVerdict(mk(["pass", "pass", "skip"])).code).toBe(0)
  })

  test("crash/fail 列表正确回传", () => {
    const v = classifyVerdict(mk(["crash", "fail", "fail"]))
    expect(v.crash).toHaveLength(1)
    expect(v.fail).toHaveLength(2)
  })
})

// ── evaluateReleaseChecks ───────────────────────────────────────────────────────
describe("evaluateReleaseChecks — L3 发布物(electron-updater 口径)", () => {
  // 用确定字节构造 exe + 对应 latest.yml(sha512/size 真算),覆盖一致/不一致路径
  const exeBuf = new Uint8Array(Buffer.from("fake-installer-bytes"))
  const realSha = createHash("sha512").update(exeBuf).digest("base64")
  const ver = "2026.7.0"
  const goodYml = (sha = realSha, size = exeBuf.length, version = ver) =>
    `version: ${version}\nfiles:\n  - url: DeskFox-Dev-${ver}-win-x64.exe\n    sha512: ${sha}\n    size: ${size}\npath: DeskFox-Dev-${ver}-win-x64.exe\nsha512: ${sha}\nreleaseDate: '2026-06-15T00:00:00Z'\n`

  const ok = (r: { checks: { name: string; ok: boolean }[] }, namePart: string) =>
    r.checks.find((c) => c.name.includes(namePart))?.ok

  test("全过:exe + yml sha512/size/版本 一致 + blockmap + LO", () => {
    const r = evaluateReleaseChecks({
      exeName: "DeskFox-Dev-2026.7.0-win-x64.exe",
      ymlText: goodYml(),
      exeBuf,
      expectVer: ver,
      hasBlockmap: true,
      hasLO: true,
    })
    expect(r.failed).toHaveLength(0)
    expect(ok(r, "sha512")).toBe(true)
    expect(ok(r, "版本号")).toBe(true)
  })

  test("sha512 不一致 → 升级命门 fail(其余可过)", () => {
    const r = evaluateReleaseChecks({
      exeName: "x.exe",
      ymlText: goodYml("WRONGSHA=="),
      exeBuf,
      expectVer: ver,
      hasBlockmap: true,
      hasLO: true,
    })
    expect(ok(r, "sha512")).toBe(false)
    expect(r.failed.some((c) => c.name.includes("sha512"))).toBe(true)
  })

  test("size 不一致 → fail", () => {
    const r = evaluateReleaseChecks({
      exeName: "x.exe",
      ymlText: goodYml(realSha, 999999),
      exeBuf,
      expectVer: ver,
      hasBlockmap: true,
      hasLO: true,
    })
    expect(ok(r, "size")).toBe(false)
  })

  test("版本号 0.0.0 → fail(版本没注入)", () => {
    const r = evaluateReleaseChecks({
      exeName: "x.exe",
      ymlText: goodYml(realSha, exeBuf.length, "0.0.0"),
      exeBuf,
      expectVer: "0.0.0",
      hasBlockmap: true,
      hasLO: true,
    })
    expect(ok(r, "版本号")).toBe(false)
  })

  test("版本号与期望不符 → fail", () => {
    const r = evaluateReleaseChecks({
      exeName: "x.exe",
      ymlText: goodYml(realSha, exeBuf.length, "2026.6.0"),
      exeBuf,
      expectVer: ver,
      hasBlockmap: true,
      hasLO: true,
    })
    expect(ok(r, "版本号")).toBe(false)
  })

  test("有 exe 但缺 latest.yml → latest.yml 存在 fail", () => {
    const r = evaluateReleaseChecks({
      exeName: "x.exe",
      ymlText: null,
      exeBuf: null,
      expectVer: ver,
      hasBlockmap: true,
      hasLO: true,
    })
    expect(ok(r, "latest.yml")).toBe(false)
  })

  test("没找到 exe → 安装包存在 fail + 不崩", () => {
    const r = evaluateReleaseChecks({
      exeName: null,
      ymlText: null,
      exeBuf: null,
      expectVer: ver,
      hasBlockmap: false,
      hasLO: false,
    })
    expect(ok(r, "安装包")).toBe(false)
    expect(ok(r, "blockmap")).toBe(false)
    expect(ok(r, "LibreOffice")).toBe(false)
  })

  test("blockmap / LO 缺失各自 fail", () => {
    const r = evaluateReleaseChecks({
      exeName: "x.exe",
      ymlText: goodYml(),
      exeBuf,
      expectVer: ver,
      hasBlockmap: false,
      hasLO: false,
    })
    expect(ok(r, "blockmap")).toBe(false)
    expect(ok(r, "LibreOffice")).toBe(false)
  })
})
