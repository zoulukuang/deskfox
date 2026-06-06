---
feat-id: telemetry-usage-stats
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# telemetry-usage-stats — 3-changelog

> 实际改动 + commit hash + 行数 + 影响范围 + 回归 + 回退。commit/push 受铁律②③门控,待 user 批准后回填 hash。

## 改动总览

匿名使用统计从"只接在不出货 Electron 端的 Node SDK"重做成"接入主力 Tauri 端的 Rust 原生客户端",数据安全前提下最小采集,opt-out 默认开。后端修复东京 Plausible 并验通。

## 客户端代码改动

| 文件 | 性质 | 改动 |
|---|---|---|
| `packages/telemetry/`(整包) | **删** | 删除 Node SDK(主力端 WebView 加载不了;仅 Electron 引用) |
| `packages/desktop-electron/src/main/telemetry.ts` / `telemetry-strategy.ts` / `telemetry.test.ts` | **删** | 删除 Electron telemetry 集成(fork 不 ship electron) |
| `packages/desktop-electron/src/main/index.ts` / `ipc.ts` / `preload/index.ts` / `preload/types.ts` / `package.json` | 改 | 清除对已删 SDK 的引用与 IPC 通道 |
| `packages/desktop/src-tauri/src/telemetry.rs` | **新** | Rust 原生客户端:install_id 读写 / opt-out 优先级(env>config>默认)/ payload 白名单 / 事件白名单 / pageview 映射 / reqwest 静默上报 / 设置开关读写 + 上报 command |
| `packages/desktop/src-tauri/src/lib.rs` | 改(FORK) | `mod telemetry` + setup 钩子 emit `app_open` + 注册 3 个 command(track_event_cmd / get_/set_telemetry_enabled) |
| `packages/desktop/src/index.tsx` | 改(FORK) | updater 流程 invoke `track_event_cmd`(update_downloaded/applied)+ 实现 platform get/setTelemetryEnabled |
| `packages/app/src/context/platform.tsx` | 改 | 接口加 getTelemetryEnabled / setTelemetryEnabled |
| `packages/app/src/components/settings-general.tsx` | 改 | 设置→通用 加"匿名使用统计"开关(Show 守卫桌面端)+ 资源加载/切换 handler |
| `packages/app/src/i18n/{en,zh,zht}.ts` | 改 | 开关标题/说明文案(其余 locale 走 fallback) |

## 采集口径(最终)

- **事件**:`app_open`(以 pageview 上报,计 DAU/启动)、`update_downloaded`、`update_applied`
- **字段**:`version` / `os`(macos/windows/linux 大类)/ `arch`(aarch64/x86_64 大类)/ `install_id`(匿名 UUID)+ 服务端从 IP 推地理(省/市级,IP 即丢)
- **不收**:project_open / ai_request / 使用时长(无心跳)/ 任何文件·prompt·模型名·个人信息·原始 IP
- **opt-out**:默认开,`设置→通用` 开关 / `OPENCODE_TELEMETRY=0` / config `telemetry:false`

## 后端改动(东京机 52.197.46.120,运维非仓库)

- 重启 Plausible 栈修 502;clickhouse 内存 compose 1300M→2400M + low-memory.xml max 1.2G→2.0G、mark_cache 512M→256M(均 .bak 备份)
- site `opencode.desktop`(id=2)已存在;验通:Today 视图 2 visitors / 1 pageview
- **遗留 todo(暂不排期)**:GeoIP 城市库、测试数据清理

## 文档改动

- `docs/legal/隐私协议.md` + `PRIVACY.md`:3.1 使用统计按新实现全量订正(事件/字段/opt-out 入口/地理城市级/数据存储改"海外服务器·匿名聚合"),修死引用 `telemetry-strategy.ts`→`telemetry.rs`,数据流图 country→地理
- `docs/features/telemetry-usage-stats/{1-spec,2-plan,3-changelog}.md` + `INDEX.md`

## 测试与回归

- Rust 单测 `telemetry::*` 13 个全绿(install_id 幂等 / opt-out 优先级 / payload 白名单 / os-arch 大类 / 事件白名单 / pageview 映射 / config roundtrip / UA 短码)
- `bun run typecheck` 16/16 全绿(删 telemetry 包后从 17→16)
- cargo check 0 error

## 已知遗留 / 跟进

- **隐私协议 3.2「更新检查」段**:描述的是已删的旧 SDK update_check(手动检查 + `OPENCODE_UPDATE_CHECK` 开关),当前实际走 Tauri 原生 auto-updater。本 feat 仅订正了其中 telemetry 事件引用(去 update_seen);**完整更新机制描述应由「启用自动升级」feat 负责对齐**(follow-up)。
- 首启告知弹窗:本实现未做 native 首启弹窗(opt-out 靠隐私协议告知 + 设置开关);如需更强告知可作 follow-up。
- GeoIP 城市库 + 测试数据清理:后续 todo,暂不排期。

## 回退方法

- 客户端:`git revert` 本 feat 分支 commit;或恢复 `packages/telemetry` 包(git 历史)+ Electron 集成。
- 后端:`/opt/plausible/docker-compose.yml.bak-*` 与 `clickhouse-config-d/low-memory.xml.bak` 还原 + 重启容器。

## commit hash

待 user 批准 commit 后回填。
