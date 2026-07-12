feat-id: deskfox-data-namespace-isolation
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

> 依据已审签 1-spec(D1=a 共享 deskfox 命名空间 / D2=a 非破坏 copy / D3 本期不动飞书)。

## 架构落点(全 fork-only,0 改上游 core)

| 单元 | 文件 | 内容 |
|---|---|---|
| N1 | **新** `packages/desktop/src/main/deskfox/data-namespace.ts` | 纯函数 `resolveDeskfoxXdg` + `planNamespaceMigration` + 编排 `applyDeskfoxDataNamespace` |
| N2 | `packages/desktop/src/main/index.ts` | whenReady 后、sidecar 前调 `applyDeskfoxDataNamespace`(在现有 `migrate()` 旁) |
| N3 | `packages/desktop/src/main/sidecar.ts` | `prepareSidecarEnv` 显式补 `XDG_DATA_HOME`/`XDG_CONFIG_HOME` passthrough(与 `XDG_STATE_HOME` 同款 `?? 默认`,防看门狗 respawn 漏设) |
| T | **新** `data-namespace.test.ts` | 纯函数单测(TC-1/2/3)+ 迁移 e2e(TC-4/5,用临时目录) |

**关键:不改 `packages/core/src/global.ts` 的 `app="opencode"` 常量** —— 靠 desktop 设 `XDG_DATA_HOME=~/.local/share/deskfox` / `XDG_CONFIG_HOME=~/.config/deskfox`,core 仍 `join(xdg,"opencode")` → 实际落 `~/.local/share/deskfox/opencode/…`,与 `~/.local/share/opencode` 物理分家。上游 merge 零冲突。

## 路径映射(D1-a)

| | 旧(共享) | 新(deskfox 专属) |
|---|---|---|
| data | `~/.local/share/opencode/` | `~/.local/share/deskfox/opencode/` |
| config | `~/.config/opencode/` | `~/.config/deskfox/opencode/` |
| state | (已 per-app userData,不动) | 不动 |
| 飞书 `~/.opencode/` | (D3 本期不动) | 不动 |

`resolveDeskfoxXdg`:`XDG_DATA_HOME` 已被显式设则**尊重**(dev/测试/power user),否则 `~/.local/share/deskfox`;config 同理。绝对路径校验。

## 迁移设计(N1 核心,最高风险 —— 求稳)

`planNamespaceMigration({ oldDataDb, newDataDir, marker })` 决策(纯函数,TC-2):
- **已迁**(marker 存在)→ skip。
- **新目录已有真 db**(用户已在新 ns 用)→ skip(绝不覆盖)。
- **旧目录无 db**(全新装 / 无历史)→ skip(无需迁,直接用空的新 ns)。
- 否则 → **migrate**。

`applyDeskfoxDataNamespace` 编排:
1. resolve 新旧路径。
2. plan。需迁则:
   - **非破坏 copy**:copy 到 `<new>.migrating` 临时目录 → 成功后原子 `rename` 成正式 → 写 marker `<newData>/.deskfox-namespace-migrated`(含来源 + 时间)。**原 opencode 目录保留不动**(不偷上游/CLI 数据)。
   - **copy 范围(data)**:全目录**排除** `log/`、`bin/`(可重下)、`*.bak-*`、`*.db-shm`/`*.db-wal`(SQLite 临时,copy db 本体即可;wal 若有未 checkpoint 数据则一并带)。→ 保 `opencode.db`+各 channel db+`auth.json`+`snapshot/`+`storage/`+`repos/`。config 目录全 copy(小)。
   - **失败保守回退**:copy/rename 任一步抛错 → 清临时目录 + **不写 marker + 不切换 XDG**(即本次仍用旧共享 ns,用户数据无损、下次启动重试),`log.error` 记账。
3. 迁移成功 / 无需迁 → `process.env.XDG_DATA_HOME`/`XDG_CONFIG_HOME` 设为 deskfox 根(sidecar 继承)。

## 决策轨迹

- **note 1 — 为何不改 core `app` 常量(与 MiMo 相反)**:MiMo 直改 `APP="mimocode"`,每次 merge 上游 `global.ts` 都要处理冲突。我们靠 desktop env 注入达到同等隔离,`global.ts` 零改 → 守「跟紧上游成本最低」。
- **note 2 — 为何 copy 不 move(D2-a)**:用户可能同机用上游 opencode CL/CLI,move 会偷走它的数据。copy 保留原目录,安全。代价临时占盘(~1.1G,db 为主),接受;迁完清理留 follow-up(需判断原目录是否上游共用,保守默认不删)。
- **note 3 — 排除 log/bin/bak**:log 可再生;bin 是按需重下的平台二进制(ripgrep 等);bak 是历史备份。排除省 ~100M+ 且不损功能。
- **note 4 — 首启 copy 性能**:1.1G 首次 copy 有几十秒,async(`fs.promises.cp`)在 sidecar 前 await;窗口/splash 期间进行。列为已知 perf 点(1-spec §6 风险),超大库优化留 follow-up。
- **note 5 — 幂等 marker 放新 data 目录**:重启秒跳;marker 缺失+新目录已有 db 也跳(防覆盖用户新数据)。

## R8 测试用例映射

TC-1 `resolveDeskfoxXdg`(env 分支 + 绝对路径校验)/ TC-2 `planNamespaceMigration`(4 分支:已迁/新有db/旧无db/该迁)/ TC-3 `applyDeskfoxDataNamespace` 设 env 正确 / TC-4 迁移 e2e(临时目录预置旧 ns → 迁 → 新 ns 有 db+auth+jsonc、旧保留)/ TC-5 幂等 / TC-6 真机同机共存不崩 / TC-7 真机老用户升级数据全在。
