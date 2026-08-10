feat-id: opencode-test-baseline
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动记录

> status 说明:Mac 段 ✅ 完成;整条 REQ-105 关闭要等 Windows 端接力产出 win 快照(README「Windows 端接力清单」),故 feat 整体仍 in-progress。

## 2026-08-10 — Mac 基线建立(commit 见 git log `[feat: opencode-test-baseline]`)

### 交付物

| 文件 | 说明 |
|---|---|
| `baseline-f04b7d5bb2-mac-arm64.txt` | 基线正文 = **确定性失败 2 条**(可 diff,注释行带 HEAD/bun/env 元数据与两轮汇总) |
| `README.md` | 基线建立流程(双端同一套)+ Mac 定性记录(确定性 2 条逐条注性质 + flaky 附录)+ Win 接力清单 |
| `1-spec.md` / `2-plan.md` | 三文档;plan 含方法学现场升级的完整决策轨迹 |

纯新增 `docs/features/opencode-test-baseline/`,0 上游文件触碰,**0 R4 override**。

### 测量结果(HEAD `f04b7d5bb2`,bun 1.3.14,清代理 + en locale,未跑 bun install)

- run1:3081 pass / 22 skip / 1 todo / **16 fail** / 1 error [382s]
- run2:3094 pass / 22 skip / 1 todo / **3 fail** [266s]
- 确定性失败(交集 + `-t` 过滤单跑 ×3 全败):**2 条** —— `ShareNext > create posts share...`(断言:fetch mock 2 次 vs 期望 1 次)、`instance HttpApi > returns typed not found bodies...`(确定性 5s 超时)。两者测试文件 git 历史全上游 commit,初判非 fork 回归,不修(REQ-105 范围明确不修)。
- 其余 14 条为冷启动/负载型 5000ms 超时 flaky(httpapi 群/workspace/agent/project-copy),入 README 附录,diff 时不作回归依据。

### 验收(R8 用例 B1-B5)

| # | 用例 | 结果 |
|---|---|---|
| B1 | 干净 env 全量跑完出汇总行 | ✅ ×2 轮 |
| B2 | 归一化清单干净(剥耗时+sort,数目与汇总一致) | ✅(16/3 条均对上) |
| B3 | 环境型假失败核对 | ✅ 代理/locale 预处理后未见 memory 速查里的 httpapi-sdk 502 群/中文快照失败;新增定性:压力超时 flaky 群实测「隔离跑不一定过」,已回写 plan |
| B4 | E6:`git status` 无 `bun.lock` 改动 | ✅ 0 diff(全程未 bun install) |
| B5 | 快照可复现性(sha+bun+env 齐) | ✅ 快照注释行 + README |

### 回退方法

纯文档目录,`git revert` 即可,无任何运行时影响。

### 遗留 / 接力

- **Windows 端**:按 README 接力清单产出 `baseline-<sha>-win-x64.txt` + 与旧 19 条三栏对照 + 复验 REQ-048 hook(git-bash `git cat-file -e`)。
- 升级后(REQ-103):同一流程重跑,只对「确定性失败」做 diff 归因;两条 Mac 既存债届时复查是否随 sync 消失。
