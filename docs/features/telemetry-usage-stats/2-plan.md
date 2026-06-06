---
feat-id: telemetry-usage-stats
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# telemetry-usage-stats — 2-plan

> 实施计划 + 决策轨迹(开发中实时追加)。spec 已于 2026-06-06 user 审签,见 1-spec「审签结论」。

## 发布策略(铁约束)
- **先不合主分支**;客户端 + 后端全部完成、验证通过后才向 user 提 merge(R9)。
- 分支:`feat/telemetry-usage-stats`。

## 实施阶段

### 阶段 0 — 清理遗留(删 SDK 包 + Electron 集成)
前置已确认:`@opencode-ai/telemetry` 仅 Electron 引用,根 workspace 未显式列出。
- [ ] 删 `packages/telemetry/` 整包
- [ ] 删 Electron telemetry 文件:`telemetry.ts` / `telemetry-strategy.ts` / `telemetry.test.ts`
- [ ] 清 Electron 引用:`main/index.ts`(import + setupTelemetry/trackEvent/flushTelemetry 调用)、`main/ipc.ts`(trackTelemetryEvent)、`preload/index.ts` + `preload/types.ts`(trackTelemetryEvent)、`package.json` 依赖
- [ ] typecheck 确认无断引用(决策 1 的 update_check 随整包删自动达成)

### 阶段 1 — Rust 客户端核心(纯逻辑 + 单测)
新文件 `packages/desktop/src-tauri/src/telemetry.rs`,FORK-only:
- [ ] `install_id`:读 `~/.cache/opencode/install_id`,无则生成 UUID 写入(复用 SDK 路径格式)
- [ ] `enabled()`:opt-out 优先级 env `OPENCODE_TELEMETRY=0` > config `telemetry:false` > 默认 true
- [ ] `payload`:构造 `{name, props:{version, os, arch, install_id}}`,os/arch 取大类
- [ ] `send_event(name)`:reqwest POST 到 Plausible `/api/event`,**静默失败不 panic**
- [ ] 单测 T1-T6(install_id 幂等 / env 优先 / config 关 / 字段白名单 / os-arch 大类 / 失败不 panic)

### 阶段 2 — 接入主程序(上游文件 ≤5 行注入,加 FORK marker)
- [ ] `lib.rs` 启动钩子 → `app_open`
- [ ] Tauri updater 流程(`lib.rs`/`windows.rs`,待细化)→ `update_downloaded` / `update_applied`
- [ ] `cli.rs` → `OPENCODE_TELEMETRY` env 读取(核对是否已部分存在)

### 阶段 3 — 设置开关
- [ ] `packages/app/src/components/settings-general.tsx` 加"匿名使用统计"开关
- [ ] 写 config(路径/字段与 Rust `enabled()` 读取一致)
- [ ] R4 核:`settings-general.tsx` 是否命中 pre-commit 路径黑名单 → 命中则走 override

### 阶段 4 — 后端 Plausible(东京机,运维)
- [ ] SSH 排查 502 根因(用现有 lightsail-tokyo SSH)
- [ ] 挂城市级 GeoIP 库(MaxMind GeoLite2-City / DB-IP City)
- [ ] 确认配置 IP 用完即丢、不入库
- [ ] 用 user 提供的看板链接验证 DAU/版本/地理可见

### 阶段 5 — 隐私政策 + 文档
- [ ] `docs/legal/隐私协议.md` 中英两版逐项更新(投递清单 + IP/UA/地理处理 + 关闭方式)
- [ ] 3-changelog 落 commit hash + 行数 + 回归
- [ ] 改动日志.md 索引回填

### 阶段 6 — 验收(R9 分支内闸)
- [ ] R8 测试清单 T1-T11 跑通
- [ ] `bun run typecheck` 全绿
- [ ] updater verify 回归(T11,删 update_check 不影响 Tauri updater)
- [ ] 真桌面手测 app_open / update_*(·native 项)

## 决策轨迹(实时追加)

- **2026-06-06**:阶段 0 前置确认 — `@opencode-ai/telemetry` 全仓仅 Electron 引用(`desktop-electron/package.json` + `main/telemetry.ts`),根 `package.json`/`turbo.json` 未显式列出(workspace 走 `packages/*` glob,删目录即可);`@effect/opentelemetry` 是无关 OpenTelemetry 库,不动。删包安全。
- **2026-06-06**:阶段 0 完成 — 删 `packages/telemetry` 整包 + Electron 3 文件 + 清 index/ipc/preload 引用 + package.json 依赖 + `bun install` 更新 lock(1 package removed,残留 0)。typecheck 16/16(原 17 减去已删 telemetry 包)。
- **2026-06-06**:阶段 1 完成 — 新建 `src-tauri/src/telemetry.rs`(install_id / opt-out 优先级 / payload 白名单 / reqwest 静默上报)+ `mod telemetry` 声明。单测 T1-T6(+T1b/T2b/T3b/T4b/T6b)共 11 个全绿。Plausible 格式取自已删 SDK 参考:POST `/api/event`,body `{name,url:"app://event",domain:"opencode.desktop",props:{version,install_id,os,arch}}`,UA `opencode-desktop/<ver> (os; arch; install=<short8>)`。os/arch 用 Rust `std::env::consts`(macos/windows/linux + aarch64/x86_64,天然大类无版本号)。
- **2026-06-06**:阶段 4 后端诊断 + 修复(东京机 `52.197.46.120`,telemetry 与 updates 同机,SSH key `~/.ssh/lightsail-tokyo-ap-northeast-1.pem`,凭据不入仓)。
  - **502 根因**:Plausible 3 容器 2 周前被显式停掉(`SIGTERM` 优雅关闭非 OOM),机器 101 天没重启故 `unless-stopped` 没拉起。`docker compose up -d` 重启 → 全部 Up。
  - **clickhouse 查询 OOM**:`/opt/plausible/clickhouse-config-d/low-memory.xml` 写死 `max_server_memory_usage=1.2GB`,空载即 91%,任何查询 OOM → 看板恒显 0。修:compose clickhouse `memory: 1300M→2000M` + low-memory.xml `1.2GB→1.7GB`,重启后查询正常(均已备份 .bak)。
  - **site `opencode.desktop` 已存在**(site_id=2,连 cli/web 共 3 个),无需新建。
  - **验证**:POST /api/event → 202;clickhouse 查到 pageview 6 / 唯一访客 5(测试数据)→ DAU 链路通。
  - **关键设计修正**:`app_open` 原作自定义事件(name=app_open)**不计入 Plausible 主面板访客/DAU**(旧库 `desktop.app_open` 4 条印证)→ 客户端改为 **pageview**(url `app://launch`),`update_*` 留自定义事件。
  - **遗留**:① GeoIP 城市库未配(当前国家级)② 库里有测试噪声数据(desktop.* + 我的验证事件)上线前可清 ③ 机器 3.7G 偏小(当前数据量可用)。
  - **2026-06-06 收敛结论**:内存调优后看板验通(Today 视图 2 visitors/1 pageview/Top sources&pages 正常)。clickhouse 在 3.7G 机上空载即顶配额,看板并发查询偶发吃紧,但**当前数据量下可用**;user 拍板"通了先这样",**后端不再优化**。**GeoIP 城市库 + 测试数据清理 留作后续 todo(暂不排期)**。后端服务器改动(compose mem 2400M / low-memory.xml max 2.0G+mark_cache 256M)均已 .bak 备份。
- **2026-06-06**:阶段 2 完成 — `lib.rs` setup 钩子 emit `app_open`(版本取 `app.package_info().version`);新增 `track_event_cmd` Tauri command 给前端 updater 流程上报 `update_*`(白名单约束)。**坑**:`#[test] test_export_types` 重生成 bindings.ts 因预存 `BigIntForbidden`(某 64 位整数 command,与本 feat 无关)失败,且 `bindings.ts` 已陈旧(仅 13/30 command)→ **改用前端直接 `invoke("track_event_cmd",{name})`**(index.tsx 既有先例 `read_e2e_save_path_env`,line 128),绕开坏掉的生成器,运行时由 `invoke_handler` 解析。cargo check 0 error + typecheck 16/16。cli.rs 无需改(telemetry.rs 直接读进程 env)。
