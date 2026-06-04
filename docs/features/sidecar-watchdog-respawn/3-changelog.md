feat-id: sidecar-watchdog-respawn
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

## 涉及两个仓库

### Layer③ 看门狗 —— 本仓 opencode-fork(分支 `feat/sidecar-watchdog-respawn`)
commit `f2d42e8e8` feat(sidecar-watchdog): Layer③ 看门狗自动重启

| 文件 | 改动 | 类型 |
|---|---|---|
| `packages/desktop/src-tauri/src/server.rs` | 新增 `spawn_watchdog()`(轮询 health → 同 port 重启 + 熔断)+ `over_restart_budget()` 纯函数 + 3 单测;补 imports(Arc/Mutex/atomic、Emitter、timeout) | FORK-BEGIN/END,~110 行 |
| `packages/desktop/src-tauri/src/lib.rs` | `ServerState` 加 `shutting_down: Arc<AtomicBool>`;`kill_sidecar` 置位防误重启;`initialize()` 共享 child handle + spawn 看门狗;password 改 clone 复用;补 atomic import | 上游核心,~20 行,全 FORK 标记 |
| `packages/app/src/pages/layout.tsx` | 监听 `sidecar-watchdog` 事件 → 前台"重启中/已恢复/重启失败"toast(`__TAURI_INTERNALS__` 守卫) | FORK,~40 行 |

### Layer① 插件截流 —— deskfox-plugins/claude-code(分支 `feat/claude-stream-firehose-cap`)
commit `46036d9` feat(firehose-cap): Layer① 咽喉点截流

| 文件 | 改动 |
|---|---|
| `src/firehose-guard.ts` | **新增**纯函数模块:`createFirehoseGuard`(reasoning 单轮 32K 字符上限,越限丢弃)/ `clampToolInput`(入参/结果大字符串字段截 16K,递归只动字符串)/ `clampReasoning`(doGenerate 单次截断) |
| `src/__tests__/firehose-guard.test.ts` | **新增** 8 单测 |
| `src/claude-code-language-model.ts` | 接入 6 处:doGenerate reasoning+入参;doStream 增量 reasoning、整块 reasoning、两处 tool-call 入参、tool-result 输出。text(答案)不动 |
| `dist/index.js` | 重建(opencode.jsonc 指向此产物) |

## 影响范围
- AI 行为:展示层截断(超长思考/大结果省略 + 提示),**答案与执行不变**
- sidecar 生死:崩/挂自愈,前台不再静默卡死

## 回归测试
- Layer① `bun test`:12 pass(8 新 + 4 既有),typecheck 干净,dist 重建成功
- Layer③ `cargo check` 通过;monorepo `bun run typecheck` 17/17 通过;Rust 单测**编译通过**(Tauri lib 测试 exe 受沙箱 WebView2 DLL 入口限制无法启动 —— 既有 `test_export_types` 同样 `0xc0000139`,非本次回归)

## 待验收(真桌面 release,见 1-spec R8 #7-#9)
- [ ] 杀 sidecar → ~15s 自动重启,前台恢复 + 提示
- [ ] 连续秒杀 → 熔断不空转
- [ ] 正常 quit → 不误重启

## 回退方法
- Layer③:`git revert f2d42e8e8`(本仓)
- Layer①:`git revert 46036d9`(deskfox-plugins)+ 重建 dist
- 两层独立可逆,互不依赖

## 未做(留 REQ-049 后续)
- Layer②(sidecar 内存熔断主动 abort 任务,改上游核心需评审)
- Layer④(插件移出 sidecar 进程,结构性隔离)
- Terminated 即时检测、消息补拉验证、i18n 化提示
