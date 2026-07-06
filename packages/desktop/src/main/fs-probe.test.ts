// FORK: REQ-068 — probePath 真实 fs 探测单测(平台无关,Windows CI 可跑)[feat: stale-path-hardening]
import { describe, expect, test } from "bun:test"
import path, { join } from "node:path"
import { probePath, probeWithStat, mountRootOf, findRelocatedWithFs, type StatFn } from "./fs-probe"

describe("probePath", () => {
  test("存在的目录 → ok", async () => {
    const result = await probePath(import.meta.dir)
    expect(result).toEqual({ ok: true })
  })

  test("不存在的目录 → missing(ENOENT)", async () => {
    const result = await probePath(join(import.meta.dir, "__definitely_not_here_REQ068__"))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("missing")
      expect(result.code).toBe("ENOENT")
    }
  })

  test("路径中间段不是目录(ENOTDIR/ENOENT)→ missing", async () => {
    // 用本测试文件自身当「父目录」,其下再挂子路径 → 父不是目录
    const result = await probePath(join(import.meta.path, "child"))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("missing")
  })
})

// FORK: REQ-068 加固 — 注入假 stat 验超时/errno 分类(离线盘挂起回归)。
// [bug-repro: 离线网络盘 stat 无超时挂起阻塞启动] 2026-06-26 [feat: stale-path-hardening]
describe("probeWithStat 超时/errno 分类", () => {
  const ok: () => Promise<unknown> = () => Promise.resolve({})
  const throws = (code: string) => () => Promise.reject(Object.assign(new Error(code), { code }))
  const neverResolves: () => Promise<unknown> = () => new Promise(() => {})
  // 路径感知 stub:按 target 给不同结果("ok" → 成功,其它 → 抛对应 errno),验「根可达性」分支
  const byTarget = (map: Record<string, "ok" | string>): StatFn => (target: string) =>
    map[target] === "ok"
      ? Promise.resolve({})
      : Promise.reject(Object.assign(new Error(String(map[target])), { code: map[target] }))
  // 平台无关取盘符根:Windows "Z:\\proj" → "Z:\\";UNC "\\\\srv\\share\\x" → "\\\\srv\\share\\"
  const winRoot = (p: string) => path.win32.parse(p).root

  test("A1 stat 瞬时成功 → ok", async () => {
    expect(await probeWithStat("/x", ok)).toEqual({ ok: true })
  })

  test("A2 目录被删但盘可达(ENOENT + 盘符根 OK)→ missing(forget)", async () => {
    const stat = byTarget({ "Z:\\proj": "ENOENT", "Z:\\": "ok" })
    expect(await probeWithStat("Z:\\proj", stat, 1000, winRoot)).toEqual({
      ok: false,
      reason: "missing",
      code: "ENOENT",
    })
  })

  test("A2b 中间段不是目录但盘可达(ENOTDIR + 盘符根 OK)→ missing", async () => {
    const stat = byTarget({ "Z:\\file\\child": "ENOTDIR", "Z:\\": "ok" })
    expect(await probeWithStat("Z:\\file\\child", stat, 1000, winRoot)).toEqual({
      ok: false,
      reason: "missing",
      code: "ENOTDIR",
    })
  })

  // [bug-repro: 可移动盘拔出/盘符未映射时 stat 报 ENOENT 被无条件归 missing → forget 永久遗忘合法项目,
  //  用户重连盘后项目从最近列表消失]
  test("A2c 可移动盘拔出/盘符未映射(ENOENT + 盘符根也 ENOENT)→ unreachable(绝不 forget)", async () => {
    const stat = byTarget({ "E:\\proj": "ENOENT", "E:\\": "ENOENT" })
    expect(await probeWithStat("E:\\proj", stat, 1000, winRoot)).toEqual({
      ok: false,
      reason: "unreachable",
      code: "ENOENT",
    })
  })

  test("A2d UNC 服务器离线(ENOENT + 共享根超时)→ unreachable", async () => {
    const stat: StatFn = (target) =>
      target === "\\\\srv\\share\\proj"
        ? Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
        : new Promise(() => {}) // 共享根 stat 挂起 → 竞速超时 → 根不可达
    expect(await probeWithStat("\\\\srv\\share\\proj", stat, 50, winRoot)).toEqual({
      ok: false,
      reason: "unreachable",
      code: "ENOENT",
    })
  })

  // FORK: REQ-070 物理盘 QA 实测修复 — macOS 外置盘挂载根(/Volumes/<name>)判定 2026-07-06
  // [bug-repro: macOS 外置盘 diskutil unmount 后 stat 报 ENOENT,v2 默认用 path.parse().root=`/`(mac 恒可达)
  //  → 误判 missing → forget 掉 U 盘项目;真机实测 /Volumes/WININSTALL 卸载复现,分类应为 unreachable]
  // 注入 mac 挂载根解析(与生产 mountRootOf 一致逻辑),平台无关可在 Windows CI 跑。
  const macRoot = (p: string) => {
    const m = /^(\/Volumes\/[^/]+)(?:\/|$)/.exec(p)
    return m ? m[1] : path.posix.parse(p).root
  }

  test("A2e macOS 外置盘卸载(ENOENT + /Volumes/<盘> 也 ENOENT)→ unreachable(绝不 forget)", async () => {
    const stat = byTarget({ "/Volumes/USB/proj": "ENOENT", "/Volumes/USB": "ENOENT" })
    expect(await probeWithStat("/Volumes/USB/proj", stat, 1000, macRoot)).toEqual({
      ok: false,
      reason: "unreachable",
      code: "ENOENT",
    })
  })

  test("A2f macOS 盘在线但目录被删(ENOENT + /Volumes/<盘> ok)→ missing(forget)", async () => {
    const stat = byTarget({ "/Volumes/USB/proj": "ENOENT", "/Volumes/USB": "ok" })
    expect(await probeWithStat("/Volumes/USB/proj", stat, 1000, macRoot)).toEqual({
      ok: false,
      reason: "missing",
      code: "ENOENT",
    })
  })

  test("A3 stat throw EACCES → unreachable(保留 lastProject)", async () => {
    expect(await probeWithStat("/x", throws("EACCES"))).toEqual({
      ok: false,
      reason: "unreachable",
      code: "EACCES",
    })
  })

  test("A4 stat 永不返回(离线盘) → 超时内返回 unreachable,绝不挂起", async () => {
    const start = Date.now()
    const result = await probeWithStat("/offline", neverResolves, 50)
    expect(result).toEqual({ ok: false, reason: "unreachable", code: "ETIMEDOUT" })
    expect(Date.now() - start).toBeLessThan(2000)
  })
})

// FORK: REQ-070 物理盘 QA 实测修复 — 生产 mountRootOf 默认实现(darwin 门控,验默认接线就是修复本体)
describe("mountRootOf (REQ-070 mac 挂载根)", () => {
  const onMac = process.platform === "darwin"
  test.if(onMac)("mac: /Volumes/<盘>/子路径 → 取挂载点 /Volumes/<盘>(而非 /)", () => {
    expect(mountRootOf("/Volumes/WININSTALL/养老")).toBe("/Volumes/WININSTALL")
    expect(mountRootOf("/Volumes/USB/a/b/c")).toBe("/Volumes/USB")
    expect(mountRootOf("/Volumes/USB")).toBe("/Volumes/USB")
  })
  test.if(onMac)("mac: 系统盘路径 → 文件系统根 /(目录真删仍应 missing)", () => {
    expect(mountRootOf("/Users/x/proj")).toBe("/")
  })
})

// FORK: REQ-072 改名 relocate — 兄弟目录 .deskfox/id 锚扫描单测(注入 fs,平台无关) 2026-07-05
describe("findRelocatedWithFs (REQ-072 改名 relocate 锚扫描)", () => {
  // 目录树用 map 模拟:parent 下若干兄弟,各自可能有 .deskfox/id
  const make = (siblings: Record<string, string | undefined>) => {
    const listDirs = async (_dir: string) => Object.keys(siblings)
    // FORK: win-anchor-hide-case-fold — 用 path.basename(而非 split("/"))取名,兼容 Windows 反斜杠候选路径
    //   (生产 findRelocatedWithFs 用 path.join 产平台分隔符;原 split("/") 在 Win 上取不到名 → 假失败)。2026-07-07
    const readAnchor = async (candidateDir: string) => {
      const name = path.basename(candidateDir)
      return siblings[name]
    }
    return { listDirs, readAnchor }
  }

  // FORK: win-anchor-hide-case-fold — 期望值用 path.join(而非硬编码正斜杠),兼容 Windows path.join 反斜杠输出。2026-07-07
  test("同父目录内改名 → 命中新名字目录(锚 id 相同)", async () => {
    const { listDirs, readAnchor } = make({ "proj-renamed": "fld_abc", other: "fld_zzz" })
    expect(await findRelocatedWithFs("/Users/x/proj", "fld_abc", listDirs, readAnchor)).toBe(
      path.join("/Users/x", "proj-renamed"),
    )
  })

  test("git 项目(id=commit hash)同理命中", async () => {
    const { listDirs, readAnchor } = make({ "myrepo-2": "8b8962650cee", nope: undefined })
    expect(await findRelocatedWithFs("/w/myrepo", "8b8962650cee", listDirs, readAnchor)).toBe(
      path.join("/w", "myrepo-2"),
    )
  })

  test("没有匹配锚 → null(跨父目录挪出去 / 目标无锚)", async () => {
    const { listDirs, readAnchor } = make({ a: "fld_1", b: "fld_2" })
    expect(await findRelocatedWithFs("/p/gone", "fld_target", listDirs, readAnchor)).toBeNull()
  })

  test("id 为空 → null(未持久化 id,不误扫)", async () => {
    const { listDirs, readAnchor } = make({ a: "fld_1" })
    expect(await findRelocatedWithFs("/p/gone", "", listDirs, readAnchor)).toBeNull()
  })

  test("跳过与旧目录同名的项 → 只命中真正的新目录", async () => {
    const { listDirs, readAnchor } = make({ proj: "fld_stale", "proj-new": "fld_abc" })
    expect(await findRelocatedWithFs("/Users/x/proj", "fld_abc", listDirs, readAnchor)).toBe(
      path.join("/Users/x", "proj-new"),
    )
  })

  test("readdir 出错(父目录不可读)→ null 不抛", async () => {
    const listDirs = async () => {
      throw new Error("EACCES")
    }
    expect(await findRelocatedWithFs("/p/gone", "fld_x", listDirs, async () => undefined)).toBeNull()
  })
})
