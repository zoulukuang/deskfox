feat-id: pre-commit-forkfile-exempt
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动记录

## 2026-08-10 — REQ-048 最小子集落地(commit 见 INDEX / git log `[feat: pre-commit-forkfile-exempt]`)

### 改动清单

| 文件 | 改动 | 性质 |
|---|---|---|
| `.husky/pre-commit` §4.1 | 新增动态「上游基准树」豁免:命中黑名单 packages 目录前缀段的文件,`git cat-file -e upstream-base:"$f"` 查上游树 —— 不存在 = fork 自建 → 豁免;存在 → 照旧拦。fail-closed(tag 缺失退回纯黑名单 + 提示 `git fetch --tags`);`while read` 循环防路径带空格 | fork 自建文件,非黑名单 |
| `docs/governance/UPSTREAM-MERGE-GUIDE.md` | §5 新增 **5.8**:每次上游 sync 合入后 `git tag -f upstream-base <上游侧 parent>` + push tag(不移则闸变松) | 根 docs/,非黑名单 |
| `docs/governance/改动规则.md` §4.1 | 补一段记录该机制 | 同上 |
| tag `upstream-base` → `be227503af` | 新增(lightweight)。= main 最近一次上游 merge `52b6a0cb62` 的上游侧 parent,upstream/dev @ 1.17.4。**push tag 待 user 门控** | — |

行数:5 文件 141 增 2 删(含三文档)。**0 R4 override**。

### 关键决策 / 发现

- **动态判定而非枚举**:施工时实测黑名单 packages 目录段内 fork 自建文件已 **47 个**(需求 doc 只点名 3 个,其中 `file-office.ts` 已消失)—— 枚举清单必然滞后,动态判定一次到位。
- **不用旧 tag `upstream-baseline`**(指 1.14.21,太旧,会把上游 1.14→1.17 新增文件误判 fork 自建 → 闸变松);另起滚动 tag `upstream-base`,sync 后移动(§5.8)。
- **根文件段不走豁免**:文件同时命中 `*.config.*` / `.github/` 等其余黑名单段时不放行(T4 验证),防 fork 新建 config 类文件钻空。

### 回归测试(R8 用例 T1-T8,全过)

| # | 用例 | 结果 |
|---|---|---|
| T1 | fork 自建文件(`libreoffice.ts`)staged → hook | ✅ exit 0,无 4.1 报错 |
| T2/T3 | 上游文件(`server.ts`)+ 混合 staged | ✅ exit 1,只报 server.ts |
| T4 | fork 新建 `packages/opencode/x.config.ts` | ✅ exit 1(根文件段仍拦) |
| T5 | 删 tag → fail-closed + `fetch --tags` 提示;恢复 tag → 放行 | ✅ |
| T6 | 删 `--conditions=browser` → §4.6 报;恢复 → 绿 | ✅(REQ-104 锁未被破坏) |
| T7 | `EXCEPTION_REGEX` 未触碰(diff 审查) | ✅ |
| T8 | 只 stage 本 feat 文件 → 五项检查通过 | ✅ |

> 验法:staged 文件 + 直接执行 `sh .husky/pre-commit` 断言退出码/输出(与真 commit 时的闸行为等价),验完 reset 现场。

### 回退方法

`git revert <commit>` + `git tag -d upstream-base`(远端若已 push tag 则 `git push origin :refs/tags/upstream-base`)。hook 退回纯黑名单行为,无其它依赖。

### Windows 端接力项

git-bash 下复验一次 `git cat-file -e upstream-base:<path>` 行为一致(路径大小写敏感,与 §4.4 检查互补);需先 `git fetch --tags`。
