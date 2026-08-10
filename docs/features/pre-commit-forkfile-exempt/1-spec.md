feat-id: pre-commit-forkfile-exempt
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-048 最小子集:pre-commit 黑名单对 fork 自建文件动态豁免

> 上位需求:OPENCODE-PLAN `需求池/pre-commit-规则全面评估.md`(REQ-048)。本 feat **只做**其中「fork 自建文件豁免」最小子集,阈值 / R4 流程 / 网络扫描 / pre-push 体验全部不碰(user 指定留全面评估单独讨论)。
> 施工方案正本:该 doc §「施工方案 —— 最小子集(2026-08-10 定稿)」,本 spec 是其在主仓的落地记录。

## 1. 问题

pre-commit §4.1 黑名单按 `packages/opencode/` 等**整目录前缀**一刀切拦,但这些目录下已有 **47 个 fork 自建文件**(2026-08-10 实测,`git ls-files` 与上游基准树 comm 对比;办公三件套 `office-installer.ts` / `libreoffice.ts` 只是最早撞上的)。改 fork 自建文件不是"动上游",却每次都触发 R4 override 手续 + 占「每季 ≤2 笔」配额 —— fork 现有 69 个 `[override-blacklist:]` commit,摩擦是常态。REQ-103 上游 sync 要碰海量文件,不先修则 sync 中途会被守门脚本反复打断。

## 2. 方案(定稿,不再调研)

**动态「上游基准树」判定,不逐文件枚举**(枚举必然滞后:doc 点名 3 个,实际 47 个,其中 `file-office.ts` 都已改名消失):

- 打 tag **`upstream-base`** → `be227503af`(main 最近一次上游 merge `52b6a0cb62` 的上游侧 parent,= upstream/dev @ 1.17.4)。
  - 现有 `upstream-baseline` tag 指 1.14.21,太旧**不可用**(会把上游 1.14→1.17 新增文件误判 fork 自建,闸变松)。
- §4.1 对命中黑名单 **packages 目录前缀段**的文件加一步 `git cat-file -e upstream-base:"$f"`:上游树中不存在 = fork 自建 → 豁免;存在 = 上游文件 → 照旧拦。
- **只对目录前缀段生效**:根文件段(`package.json` / `bun.lock` / `*.config.*` / `.github/` / src-tauri 段等)不走此逻辑,行为不变。实现上:文件若还命中「除 packages 目录段以外」的黑名单模式(如 fork 新建 `packages/opencode/foo.config.ts` 撞 `*.config.*` 段),**不豁免**。
- **fail-closed**:tag 不存在(新 clone 未 `git fetch --tags`)→ 退回纯黑名单行为 + 提示拉 tag,绝不 fail-open。
- 现有 `EXCEPTION_REGEX` 保留不删(冗余保险 + 覆盖 `.github/` 等非 packages 段豁免)。
- 治理文档同步:`UPSTREAM-MERGE-GUIDE.md` §5 加「sync 后移 `upstream-base` tag」条目(不移则闸变松);`改动规则.md` §4.1 记录机制。

## 3. 验收标准(= OPENCODE-PLAN 2026-08-09 计划验收门槛第 3 条)

- 碰 fork 自建文件的 commit **不再触发 R4 override**
- 真正动上游的文件**仍然被拦**(闸不能修松)
- REQ-104 §4.6 断言在新 hook 下仍通过
- tag 缺失时 fail-closed(仍拦 + 提示)

## 4. 测试用例清单(R8,动工前锁定)

> 层级:hook 为 shell 守门脚本,无单测框架;全部用「staged 文件 + 直接执行 `sh .husky/pre-commit` + 断言退出码/输出」的方式验,等价于真 commit 时的闸行为。验完 `git reset` 现场。

| # | 用例 | 做法 | 预期 |
|---|---|---|---|
| T1 | fork 自建文件豁免 | `packages/opencode/src/office/libreoffice.ts` 加空注释 → stage → 跑 hook | **exit 0**,无 4.1 报错 |
| T2 | 上游文件仍拦 | `packages/opencode/src/server/server.ts` 加空注释 → stage → 跑 hook | **exit 1**,4.1 报该文件 |
| T3 | 混合 staged(T1+T2 同时) | 两文件都 stage | exit 1,**只报 server.ts**,不报 libreoffice.ts |
| T4 | 根文件段不走豁免 | 假想 fork 新建 `packages/opencode/x.deskfox2.config.ts`(上游无)stage | exit 1(撞 `*.config.*` 段,豁免逻辑不放行) |
| T5 | fail-closed | 临时 `git tag -d upstream-base` → 重跑 T1 场景 | exit 1(退回纯黑名单)+ 输出含 `git fetch --tags` 提示;测完恢复 tag |
| T6 | REQ-104 §4.6 仍响 | 删 `packages/app/package.json` 的 `--conditions=browser` → 跑 hook | exit 1,4.6 报参数缺失;恢复后 exit 0 |
| T7 | 静态例外不回归 | `.github/workflows/xx-deskfox.yml` 类路径仍走 EXCEPTION_REGEX | grep 验 regex 未被改坏(T1-T6 跑通 + diff 审查覆盖) |
| T8 | 全绿路径 | 只 stage 本 feat 的 docs/hook 文件 | exit 0,五项检查通过输出 |

## 5. 影响范围

- `.husky/pre-commit`(fork 自建文件,非黑名单 —— REQ-104 施工已验证)
- `docs/governance/UPSTREAM-MERGE-GUIDE.md` / `docs/governance/改动规则.md`(根 docs/,非黑名单)
- tag `upstream-base`(新增,push 待 user 门控)
- **0 R4 override**

## 6. 明确不做

- REQ-048 全面评估(diff 阈值 / R4 流程 / 网络扫描 / pre-push e2e 体验)—— 留 backlog,user 单独拍板
- 本 feat 完成后 REQ-048 **不归档**,降回 ⬜ 并记已做子集
