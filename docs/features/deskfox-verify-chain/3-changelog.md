feat-id: deskfox-verify-chain
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — DeskFox verify 链

## 概述

把 DeskFox 既有验收零件(typecheck+oxlint 静态 / `smoke.py` CDP 冒烟 / 冷启动健康 / 发布物校验)编排成**一条命令、一个退出码判定、按 git 改动自动选层**的 verify 链,并把它立成 R9 验收铁律(View/CDP 部分用 `verify.ts` 跑、🔴 不进 merge、🟡 须 user 确认)。目的:把 DeskFox 复核从"逐条人看"降为"只看没过项",降 user 复核带宽。

## Commit 列表

| commit | 内容 | 行数 |
|---|---|---|
| `c2e30bf20` | `test(verify)`:冷启动健康脚本入仓 + 修 conn-refused 预热误报 | `cold-start.py` +127 |
| `763c1eac4` | `test(verify)`:verify 链编排器 L0/L1/L2/L3 一键判定 | `verify.ts` +401 |
| `faac87b19` | `docs(governance)`:verify 链验收铁律入规范(R9 callout + 修订记录 v7) | `自动化测试规范.md` +7 |

合入 main:`368155e93`(Merge feat/deskfox-verify-chain → main)。三文档(本目录)+ INDEX/改动日志登记为事后补齐(`docs/deskfox-verify-chain-docs` 分支)。

## 实际改动

- **新增 `packages/branding/smoke/verify.ts`**(401 行,fork-only)— 编排器:
  - 四层:**L0 静态**(`bun run typecheck` + `bun run lint`)/ **L1 冷启动**(`--cold`,杀全部→真冷启→`cold-start.py` 监控 ~22s)/ **L2 交互**(连 CDP 9222 跑 `smoke.py` probe:boot/providers/panels/settings/files)/ **L3 发布物**(`--release`/`--build`,校验 `dist-deskfox`)。
  - flag:`--changed`(按 git 改动选 probe)/ `--scope ui|provider|viewer|all` / `--only <probe>` / `--no-static` / `--no-launch` / `--cold` / `--release` / `--build` / `--env dev|beta|prod`。
  - probe 选择优先级:`--only` > `--changed` > `--scope` > 全量。
  - 退出码:`0`=🟢 全过 / `2`=🟡(L2 软警告:空白/报错/弹窗没开;L3 无此档)/ `1`=🔴(L0 不过 / L2 crash / L3 任一不过)。
  - 自动探活 9222:复用在跑的 dev(自动剔 boot 免 reload 打断会话);没起则后台拉 dev、跑完只杀自己拉起的那个。
  - L3 electron-updater 口径:安装包存在 / **latest.yml sha512 与 exe 实算一致**(升级命门)/ 版本非 0.0.0 / `.blockmap` / LibreOffice 进包。
- **新增 `packages/branding/smoke/cold-start.py`**(127 行,fork-only)— 冷启动健康监控(L1 用):
  - 自 `OPENCODE-PLAN/诊断工具/cold-start-health-check.py` 迁入,使 L1 闸自包含。
  - **修 conn-refused 误报**:冷启 sidecar ~1.5s 预热窗口的 `ERR_CONNECTION_REFUSED` 单独计数,终态已连上才算预热瞬时,始终没连上才算真 FAIL(保留 sidecar 没起来的真检出)。判定 🟢0 / 🔴1 / 2(renderer 未出现)。
- **改 `docs/governance/自动化测试规范.md`**(+7 行):R9 下加 **verify:deskfox 验收链铁律** callout(改完、提 merge 前必跑 `bun run packages/branding/smoke/verify.ts` 并贴判定;🔴/L0 不过不进 merge,🟡 须 user 确认;`--cold` 改启动链时用 / `--release` 发版前用)+ 修订记录 **v7**。

## 影响范围

- 纯 fork-only(`packages/branding/smoke/` + 一份治理文档)。**0 改上游 / 0 R4 / 0 黑名单**(刻意不注册 `package.json` npm 别名以避开黑名单 + 上游合并摩擦)。
- 不改任何产品运行时代码 —— verify 链是验收工具,不进打包产物。

## 回归测试

- typecheck / oxlint 通过;`verify.ts` 多 flag 跑通;`cold-start.py` 冷启动监控判定正确。
- 既有 `smoke.py` 冒烟系统、`build-deskfox-electron` 构建链不受影响(verify 链只调用、不修改它们)。

## 回退方法

`git revert` 对应三笔 commit,或删 `packages/branding/smoke/verify.ts` + `cold-start.py` + 回滚 `自动化测试规范.md` 的 v7 段。无运行时行为,回退零风险。

## 后续:Logic 清单单测补齐(2026-06-15,feat: verify-core-tests)

初版 `verify.ts`(Medium)合入时纯逻辑全埋在脚本里、无单测(R5 Logic 清单缺口)。补齐:

- **helper-extract**:把 4 个纯函数抽到新 `packages/branding/smoke/verify-core.ts`(`probesFromChangedFiles` / `selectProbes` / `classifyVerdict` / `evaluateReleaseChecks`,零 IO/零 console/零进程),`verify.ts` 改为 import 委托(行为逐字不变,git/CDP/文件 IO 仍留外壳)。
- **单测** `packages/branding/__tests__/verify-core.test.ts`:**29 用例**覆盖 git→probe 映射(各规则 + 无 desktop/无命中两档全量回退 + 并集)、probe 选择优先级(only>changed>scope>全量 + 未知抛错 + scope 映射)、冒烟判定(crash→1🔴/fail→2🟡/全过→0🟢)、L3 发布物(sha512 一致性「升级命门」+ size + 版本号 0.0.0/不符 + 缺 yml + blockmap/LO)。
- 验证:branding typecheck 0 错 / verify-core 29 pass / branding 全量无回归(预存的 updater-config minisign.pub ENOENT 与本次无关)。纯 fork-only;0 改上游 / 0 R4 / 0 黑名单。
