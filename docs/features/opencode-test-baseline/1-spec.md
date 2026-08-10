feat-id: opencode-test-baseline
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-105:opencode 单测可信基线(Mac + Win 双平台快照)

> 上位需求:OPENCODE-PLAN `需求池/opencode-win测试基线-shell-permission-fail.md`(REQ-105)。REQ-103(上游同步 1.18.x)的前置项。
> **范围只做「重建可信基线」,不修失败用例**。修不修那批 shell permission 失败是升级后按 diff 结果的事。

## 1. 问题

2026-05-28 在 Windows 上跑 `packages/opencode` 全套单测有 19 个基线失败(shell permission 为主)。原决策「下次 sync 时一并核」顺序反了:基线和升级同时变动,升级后跑出 N 个 fail 无法归因 —— 而「全量单测通过」正是 REQ-103 的验收标准之一。且 5-28 之后 main 又吃了一次上游 merge(6-13,@1.17.4),旧「19 条」清单已过时(其中 OpenAPI shape 那条的测试文件已被上游删除,2026-08-10 已核)。必须在升级动手前,在当前 HEAD 上重新拿到**可 diff 的失败用例名清单**(只记数字不够 —— 数字相同但换了一批用例同样是回归)。

## 2. 方案(定稿)

双端同一条归一化命令,输出可 diff 的失败用例名清单(剥耗时、排序):

```bash
cd packages/opencode && bun test 2>&1 | tee /tmp/opencode-test-raw.log
grep -E '^\(fail\)' /tmp/opencode-test-raw.log | sed -E 's/ \[[0-9.]+m?s\]$//' | sort > baseline-<HEAD短sha>-<platform>.txt
# 末尾附汇总行:pass / skip / todo / fail 四个数
```

- 快照落 `docs/features/opencode-test-baseline/`(根 `docs/`,非黑名单,0 override),README 记 HEAD sha、bun 版本、日期、平台、环境预处理。
- **环境预处理钉死**(否则环境型假失败污染基线,不可比):清代理(`ALL_PROXY`/`HTTP(S)_PROXY` 全 unset;Clash 代理拦 localhost 会让 httpapi/lsp 整组 502)+ `LANG=LC_ALL=en_US.UTF-8`(yargs help 快照跟 locale)。
- **E6 坑防护**:跑测试不需要 `bun install`;若跑了,commit 前必查 `git status`,`bun.lock` 被 npmmirror 镜像重写(3323 行 resolved URL)则 `git checkout -- bun.lock`。
- **Mac 段先行**(本 feat):验证归一化命令产出干净清单 + 留 Mac 基线(升级后 Mac 同样要 diff)。
- **【2026-08-10 施工补充,只补不改】**单轮全量不可作基线:实测 run1=16 fail / run2=3 fail,冷启动超时 flaky 占绝对多数。流程升级为「全量 ×2 取交集 → 交集逐条 `-t` 过滤单跑 ×3 → 3/3 败才入基线正文」,详见本目录 README.md。
- **Win 段接力**(Mac commit 后):同一命令产出 `baseline-<sha>-win.txt`,与旧 19 条清单对比写「消失/仍在/新增」三栏;顺手复验 REQ-048 新 hook 的 `git cat-file -e` 在 git-bash 下行为一致。

## 3. 验收标准(= OPENCODE-PLAN 2026-08-09 计划验收门槛第 2 条)

- 拿到当前 HEAD 基线的**失败用例名清单**(可 diff、已归一化)
- `office-tooling/install` hono/effect shape 分诊有结论 —— ✅ 已于 2026-08-10 核查完成:测试文件被上游 `28b03595bf` 删除,fork 路由已迁 effect PublicApi,**已消解条目**;本次跑基线确认不再出现即可
- 完成定义(整条 REQ-105):Mac + Win 两份基线快照入库;本 feat 交付 Mac 段,Win 段由 Windows 端接力

## 4. 测试用例清单(R8)

> 本 feat 的交付物本身就是测试运行结果;R8 用例围绕「基线可信」:

| # | 用例 | 预期 |
|---|---|---|
| B1 | 干净 env 全量跑 `bun test`(不 `bun install`) | 跑完出汇总行(pass/skip/todo/fail 四数齐) |
| B2 | 归一化命令产出清单 | 每行 `(fail) <套件> > <用例名>`,无耗时尾巴,已 sort;fail 数与汇总行一致 |
| B3 | 环境型假失败核对 | 对照 memory 速查(代理/locale/fff-bun native/lock 守卫),命中的在 README 里标注性质,不当 fork 回归 |
| B4 | E6 检查 | commit 前 `git status` 无 `bun.lock` 改动 |
| B5 | 快照可复现性说明 | README 含 HEAD sha + bun 版本 + env 预处理,换机可重跑同条件 |

## 5. 影响范围

纯新增 `docs/features/opencode-test-baseline/`(文档 + 数据),0 上游文件触碰,0 R4 override。

## 6. 明确不做

- 不修任何失败用例(含 Win 那 15 条 shell permission)
- 不动 `packages/opencode` 任何代码
