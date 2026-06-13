// [fork-only] telemetry Electron 端口单测 — 从 Tauri telemetry.rs #[cfg(test)] 平移
//   [feat: telemetry-usage-stats / electron-replatform] 2026-06-13
import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import {
  resolveEnabled,
  parseTelemetryField,
  buildEventBody,
  userAgent,
  osClass,
  archClass,
  getOrCreateInstallIdIn,
  setTelemetryEnabledIn,
} from "./telemetry"

function tempDir(tag: string): string {
  const dir = path.join(os.tmpdir(), `deskfox-telemetry-test-${tag}-${process.pid}`)
  fs.rmSync(dir, { recursive: true, force: true })
  return dir
}

// T1 — install_id 生成 + 持久化幂等
describe("install_id", () => {
  test("T1 生成 + 落盘 + 幂等", () => {
    const home = tempDir("t1")
    const dir = path.join(home, ".cache", "opencode")
    const first = getOrCreateInstallIdIn(dir)
    expect(first).not.toBe("")
    expect(first).not.toBe("unknown")
    expect(fs.existsSync(path.join(dir, "install_id"))).toBe(true)
    expect(getOrCreateInstallIdIn(dir)).toBe(first) // 二次读同值
    fs.rmSync(home, { recursive: true, force: true })
  })

  test("T1b 无目录降级 unknown 不抛", () => {
    expect(getOrCreateInstallIdIn(null)).toBe("unknown")
  })

  test("T1c 脏值(非 UUID/含控制字符)丢弃重生成", () => {
    const home = tempDir("t1c")
    const dir = path.join(home, ".cache", "opencode")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "install_id"), "garbage\n\x01injected")
    const id = getOrCreateInstallIdIn(dir)
    expect(/^[0-9a-f-]{36}$/i.test(id)).toBe(true)
    expect(id).not.toBe("garbage")
    fs.rmSync(home, { recursive: true, force: true })
  })
})

// T2/T3 — opt-out 优先级 env > config > 默认
describe("resolveEnabled", () => {
  test("T2 env=0/false/off 强制禁用(无视 config)", () => {
    expect(resolveEnabled("0", true)).toBe(false)
    expect(resolveEnabled("false", true)).toBe(false)
    expect(resolveEnabled("off", undefined)).toBe(false)
  })
  test("T2b env=1/true 强制启用", () => {
    expect(resolveEnabled("1", false)).toBe(true)
    expect(resolveEnabled("true", false)).toBe(true)
  })
  test("T3 config 决定(env 未设)", () => {
    expect(resolveEnabled(undefined, false)).toBe(false)
    expect(resolveEnabled(undefined, true)).toBe(true)
  })
  test("T3c 默认开;无法识别 env 落到 config/默认", () => {
    expect(resolveEnabled(undefined, undefined)).toBe(true)
    expect(resolveEnabled("garbage", undefined)).toBe(true)
  })
})

// T9 — jsonc 解析(opt-out 失灵修复核心)
describe("parseTelemetryField", () => {
  test("T9 纯 JSON / 注释 / 尾逗号 / 中文 / 无字段", () => {
    expect(parseTelemetryField(`{"telemetry": false}`)).toBe(false)
    expect(parseTelemetryField('{\n  // 关闭\n  "telemetry": false, /* x */\n  "theme": "dark"\n}')).toBe(false)
    expect(parseTelemetryField(`{"telemetry": false,}`)).toBe(false)
    expect(parseTelemetryField(`{ "theme": "暗色", "telemetry": true }`)).toBe(true)
    expect(parseTelemetryField(`{"theme":"dark"}`)).toBeUndefined()
  })
})

// T4 — payload 字段白名单
describe("buildEventBody", () => {
  test("T4 app_open→pageview + props 仅 4 白名单字段 + 无敏感字段", () => {
    const v = JSON.parse(buildEventBody("app_open", "opencode.desktop", "2026.6.0", "abc-123"))
    expect(v.name).toBe("pageview")
    expect(v.url).toBe("app://launch")
    expect(v.domain).toBe("opencode.desktop")
    expect(Object.keys(v.props).sort()).toEqual(["arch", "install_id", "os", "version"])
    expect(v.props.version).toBe("2026.6.0")
    for (const forbidden of ["path", "project", "prompt", "model", "ip", "user", "email"]) {
      expect(v.props[forbidden]).toBeUndefined()
    }
  })
  test("T4 update_*→自定义事件(原名 + app://event)", () => {
    const v = JSON.parse(buildEventBody("update_downloaded", "opencode.desktop", "2026.6.0", "abc"))
    expect(v.name).toBe("update_downloaded")
    expect(v.url).toBe("app://event")
  })
})

// T5 — os/arch 大类
describe("os/arch 大类", () => {
  test("T5 是固定大类、无版本号/空格", () => {
    expect(["macos", "windows", "linux"]).toContain(osClass())
    expect(["aarch64", "x86_64", "x86", "arm"]).toContain(archClass())
    expect(osClass().includes(".")).toBe(false)
    expect(archClass().includes(" ")).toBe(false)
  })
})

// T6b — user_agent 短码
test("T6b user_agent 用短码不暴露完整 install_id", () => {
  const ua = userAgent("2026.6.0", "abcdefgh-1234-5678-9012-xxxxxxxxxxxx")
  expect(ua).toContain("opencode-desktop/2026.6.0")
  expect(ua).toContain("install=abcdefgh")
  expect(ua).not.toContain("abcdefgh-1234")
})

// T7 — config 写读 roundtrip + 保留其余字段
describe("setTelemetryEnabledIn", () => {
  test("T7 写 telemetry + 保留其余字段 + roundtrip", () => {
    const home = tempDir("t7")
    const cfg = path.join(home, ".config", "opencode")
    fs.mkdirSync(cfg, { recursive: true })
    const file = path.join(cfg, "config.json")
    fs.writeFileSync(file, `{"theme":"dark","telemetry":true}`)
    setTelemetryEnabledIn(file, false)
    let v = JSON.parse(fs.readFileSync(file, "utf-8"))
    expect(v.telemetry).toBe(false)
    expect(v.theme).toBe("dark")
    setTelemetryEnabledIn(file, true)
    v = JSON.parse(fs.readFileSync(file, "utf-8"))
    expect(v.telemetry).toBe(true)
    fs.rmSync(home, { recursive: true, force: true })
  })
  test("T7b config 不存在时新建", () => {
    const home = tempDir("t7b")
    const file = path.join(home, ".config", "opencode", "config.json")
    expect(fs.existsSync(file)).toBe(false)
    setTelemetryEnabledIn(file, false)
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).telemetry).toBe(false)
    fs.rmSync(home, { recursive: true, force: true })
  })
})
