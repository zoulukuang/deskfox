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

## Follow-up:code-review 加固(2026-06-07)

`/code-review high` 后修掉 4 项(均在 `telemetry.rs` + `lib.rs`,新增 3 单测 → telemetry 共 16 全绿):
- **#1 config 原子写**:`write_telemetry_config_in` 改为「写同目录临时文件(带 pid)→ rename 覆盖」,避免并发写 / 写到一半被杀把共用的 `config.json` 截断成半截 JSON(opencode 合并加载会失败)。
- **#3 channel 隔离**:删 `const DOMAIN`,改 `domain_for_identifier(identifier)` 按 bundle identifier 选 Plausible site(prod=`opencode.desktop` / beta=`-beta` / dev 及未知=`-dev`),防 dev/beta 的开发/QA 流量污染 prod 统计;`track` 加 `identifier` 参数,两调用点传 `app.config().identifier`。(beta/dev site 未建时后端 202 丢弃,不污染 prod;要看预览渠道统计时再建 site。)
- **#6 install_id 0600**:落盘后 `restrict_to_owner` 收紧到 0600(Unix),匿名设备 ID 不被同机其他用户读到。
- **#8 install_id UUID 校验**:读到非 UUID 脏值(云同步/外部进程写入、含控制字符)丢弃重生成,防脏值进 payload / UA header(控制字符会让 reqwest 构造 header 失败 → 该机 telemetry 永久静默失效)。
- 新增单测:T1c(脏值重生成)/ T1d(0600 权限,Unix)/ T8(channel→site 映射)。

### 第二批(2026-06-07,把上批"未修"的剩余项也修掉)

telemetry 16 单测 + typecheck 16/16 + app 808 全绿:
- **#2 update_applied relaunch 前丢失**:新增 `track_blocking` + `track_event_blocking_cmd`(async,等发送完成再返回);前端 `update_applied` 改为 `await invoke("track_event_blocking_cmd")` 再 `relaunch()`,确保事件发出。`update_downloaded` 保持 fire-and-forget。
- **#10 setup 主线程同步文件 IO**:`track` 重构为先 `prepare_event`(opt-out 判定 + 文件 IO)整个丢进后台 spawn,启动线程不再做任何文件 IO。
- **#4 UI 开关忽略 env**:`get_telemetry_enabled` 改返回 `is_enabled()` 有效值(env>config>默认),UI 显示与实际上报一致(env 覆盖时不再显示假状态)。
- **#5 不读 opencode.jsonc**:`read_config_telemetry` 改按 opencode 合并优先级读 `config.json`<`opencode.json`<`opencode.jsonc`(后者覆盖),用户在任一文件写 `telemetry:false` 都生效(jsonc 含注释时严格解析跳过,本仓无 json5 依赖;env 兜底)。顺带抽 `home_base()`/`config_dir()` 去重路径解析。
- **#7 opt-out 写失败静默**:`set_telemetry_enabled` 改返回 `Result<(),String>`;前端 `setTelemetryEnabled` 不再吞错,设置页 `onTelemetryChange` 改 async + try/catch → 失败 `showToast` 提示 + refetch 回正(新增 i18n `...telemetry.saveFailed` en/zh/zht)。
- **#9 事件名无共享常量**:前端新增 `TELEMETRY_EVENT` 常量集中事件名(注释指向 Rust `ALLOWED_EVENTS` 为准),消除 call site 散落字符串拼错风险。
- 改动文件:`telemetry.rs` / `lib.rs` / `index.tsx` / `settings-general.tsx` / `platform.tsx`(签名不变)/ i18n×3。
- **全部 code-review 项已清**(#1-#10);剩 `docs/legal` 隐私协议 3.2 更新检查段完整化仍归"启用自动升级"feat follow-up。

## 已知遗留 / 跟进

- **隐私协议 3.2「更新检查」段**:描述的是已删的旧 SDK update_check(手动检查 + `OPENCODE_UPDATE_CHECK` 开关),当前实际走 Tauri 原生 auto-updater。本 feat 仅订正了其中 telemetry 事件引用(去 update_seen);**完整更新机制描述应由「启用自动升级」feat 负责对齐**(follow-up)。
- 首启告知弹窗:本实现未做 native 首启弹窗(opt-out 靠隐私协议告知 + 设置开关);如需更强告知可作 follow-up。
- GeoIP 城市库 + 测试数据清理:后续 todo,暂不排期。

## 回退方法

- 客户端:`git revert` 本 feat 分支 commit;或恢复 `packages/telemetry` 包(git 历史)+ Electron 集成。
- 后端:`/opt/plausible/docker-compose.yml.bak-*` 与 `clickhouse-config-d/low-memory.xml.bak` 还原 + 重启容器。

## commit hash

待 user 批准 commit 后回填。
