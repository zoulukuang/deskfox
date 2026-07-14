feat-id: deskfox-data-namespace-isolation
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — DeskFox 运行期数据/配置命名空间隔离

## 背景

2026-07-12 Intel 真机报「任意模型连不上」,真因 = DeskFox 与用户另装的**上游 OpenCode 桌面端**共用同一 `~/.local/share/opencode/opencode.db`,两个不同版本核心 schema 打架(`no such column`)必崩。方案:把 DeskFox 运行期数据/配置隔离到专属 `deskfox` 命名空间,与上游物理分家。

## 实际改动

| 文件 | 改动 | 类型 |
|---|---|---|
| `packages/desktop/src/main/deskfox/data-namespace.ts` | 新增:`resolveDeskfoxXdg`(纯)+ `planNamespaceMigration`(纯)+ `applyDeskfoxDataNamespace`(编排):把 `XDG_DATA_HOME`/`XDG_CONFIG_HOME` 指向 `~/.local/share/deskfox` / `~/.config/deskfox`(core 仍 `join(xdg,"opencode")` → 落 `deskfox/opencode/…`,与上游 `opencode/…` 分家);首启非破坏 copy 迁移旧 opencode ns(排除 log/bin/*.bak-*/*.db-shm,原目录保留),幂等 marker,失败保守回落。 | 新增 fork-only |
| `packages/desktop/src/main/deskfox/data-namespace.test.ts` | 新增:TC-1~5 单测 + TC-7 加强 e2e,共 12 pass | 新增 fork-only |
| `packages/desktop/src/main/index.ts` | `whenReady` 后、sidecar 前 `await applyDeskfoxDataNamespace()`(`TEST_ONBOARDING` 跳过),FORK marker | 改上游(+7 行) |
| `docs/features/deskfox-data-namespace-isolation/{1-spec,2-plan}.md` | 需求 + 计划 + 进度补记 | 文档 |

commit:`7cd29e8948`(1-spec)/ `b27670758f`(主体)/ `c781aa53e4`(TC-7 加强 e2e)/ `594c52d22d`(TC-7 真机回填)。反查 `git log --grep '[feat: deskfox-data-namespace-isolation]'`。

**上游侵入:1 文件**(`index.ts` +7 行,FORK marker)。**0 改上游 core**(不动 `global.ts` 的 `app='opencode'` 常量)→ merge 上游零冲突,上游收益靠 code merge 不受影响。

## 影响范围

- **全量用户数据路径变更**:新装/升级用户运行期数据落 `~/.local/share/deskfox` 而非 `~/.local/share/opencode`。
- **老用户升级**:首启一次性非破坏 copy 迁移(旧目录保留,正式版/上游数据无损)。
- 迁移 copy ~1.1G(db 为主)首启耗时几十秒~1min(已知 perf 点,超大库优化留 follow-up)。

## 回归测试

- `bun test src/main/deskfox/data-namespace.test.ts` → 12 pass 0 fail
- 全套 fork 包回归 + typecheck(合并前,见下)

## 测试用例(R8)完成情况

- **TC-1~5**(纯函数 + 迁移 e2e + 幂等)→ ✅ 单测 12 pass
- **TC-7**(老用户升级数据全保留)→ ✅ 两层都过:文件层由「TC-7 加强 e2e」覆盖(多 db/wal-shm 边界/深层嵌套/非破坏);app 集成层真机 local 版验证(真实 1.2G 迁移成功 + marker + 旧目录非破坏 + app 内会话/key 保留可用)
- **TC-6**(同机与上游 OpenCode 官方版并存不崩,Intel 报障复现)→ ⬜ **backlog**:需另装上游 OpenCode 官方桌面端才能真复现。隔离本质(迁移到独立 `deskfox` ns、与上游 `opencode` ns 物理分家)已由 TC-7 证明;此项留有上游版环境时补。

## 回退方法

`git revert <主体 commit>` 单笔回退;`index.ts` 回到不调用 `applyDeskfoxDataNamespace`,运行期回落共享 `opencode` ns(已迁移的 `deskfox` 副本无害残留,可手动删)。

## 已知 follow-up(不阻塞合并)

- TC-6 真机复现(需上游版)。
- 迁移后清理旧共享目录(需判断是否上游共用,保守默认不删)。
- 超大库(>1G)首启 copy perf 优化。
- **预迁移 marker 新鲜度边界**(2026-07-14 Windows QA 暴露):marker 落在 `deskfox` ns。若某次运行已迁移建了 marker,而其后仍有进程往【旧 `opencode` ns】写(如另一台端/旧版本 app 继续用旧 ns),下次首启见 marker → 跳过迁移 → 用旧快照 → 丢失这期间旧 ns 的新写入。当前设计对「单端顺序升级」正确;多端并存 / 预迁移场景是已知语义边界,与「迁移后清理旧共享目录」一并评估。

## Windows 端 QA(2026-07-14,分支 `chore/win-adapt-namespace-isolation`)

原 QA 记录均为 Mac/Intel 真机;本节补 Windows 端。**核心风险**:隔离靠 `XDG_DATA_HOME`/`XDG_CONFIG_HOME`,而 Windows 非 XDG 平台,怕隔离静默失效。**结论:Windows 上成立,端到端验证通过。**

| 用例 | 结果 | 证据 |
|---|---|---|
| TC-W1/2/3 Logic 层 | ✅ | `data-namespace.test.ts` 12 pass on Windows;日志实证 cp / 跨目录 rename / marker / 幂等 / same-dir / fresh 全走真实 Windows 路径(`D:\…\.local\share\opencode → …\deskfox\opencode`) |
| TC-W4 xdg-basedir 认 XDG | ✅ | `xdg-basedir@5.1.0` 源码无 Windows 特判(`xdgData = env.XDG_DATA_HOME \|\| ~/.local/share`);运行时实测 `HONORS_XDG = true`,core 会 join → `…\deskfox\opencode` |
| TC-W5 db 落 deskfox ns | ✅ | 真机 local 版启动后 `~\.local\share\deskfox\opencode\` 含 `opencode.db` + `opencode-local.db`(后者 sidecar 新建 → **XDG 端到端接通坐实**:主进程设 env → sidecar 继承 → core 读 → db 落 deskfox ns) |
| TC-W6 非破坏迁移 | ✅ | 旧 `opencode` ns 完好 + `.deskfox-namespace-migrated` marker 落地 + 无 `.migrating` 残留(原子完成);真机迁移真实数据 2.1G |
| TC-W7 隔离后冷启动 | ✅ | 真 home 启动 running + CDP 200 |

**过程踩坑(方法论,留给后来者)**:

- 为「不碰真实数据」用**隔离 USERPROFILE**(指向骨架临时 home)启动 → electron 启动早期 abort(`0x80000003` STATUS_BREAKPOINT,logging 前)。**这是 Windows 测试方法坑,非产品 bug**:Windows 上 home 缺 AppData 结构会让 electron/crashpad CHECK 失败;真实用户永远有正常 USERPROFILE,不触发。
- Windows 上迁移**无法只靠设 XDG env 测**:设了 `XDG_DATA_HOME` 后 old==new(均以 XDG 根为准)→ `same-dir` 短路、迁移 no-op。迁移只在 XDG 未设、走 `homedir()` 默认时触发 → 真机验证只能用真 home(会真迁真实数据)。故 Windows 端到端迁移验证由「真 home 启动实迁 2.1G」完成,测试产物随后清理(旧 ns 是真相源,删副本无损)。
