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
