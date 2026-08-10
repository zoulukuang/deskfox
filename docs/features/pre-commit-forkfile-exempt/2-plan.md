feat-id: pre-commit-forkfile-exempt
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

## 步骤

1. `git tag upstream-base be227503af`(本地先打;push tag 过 user 门控)✅
2. 改 `.husky/pre-commit` §4.1:
   - 新增 `PKGDIR_REGEX`(黑名单里的 packages 目录前缀段,单独拎出)与 `OTHER_BLACKLIST_REGEX`(其余段)。
   - 原 `violations` 初筛后逐文件复核:命中 PKGDIR 段、**不**命中其余段、且 `git cat-file -e upstream-base:"$f"` 失败(上游树无此文件)→ 豁免;否则保留违规。
   - tag 不存在 → 跳过复核(fail-closed)+ 报错时附 `git fetch --tags` 提示。
   - 用 `while read` 循环防文件名带空格(仓里有中文/空格路径)。
3. `UPSTREAM-MERGE-GUIDE.md` §5 加 5.8:sync 合入后把 `upstream-base` 移到新上游侧 parent 并 push tag。
4. `改动规则.md` §4.1 末尾加一段记录动态豁免机制。
5. 按 1-spec §4 用例 T1-T8 逐条验;写 3-changelog + 挂 INDEX;commit(标 `[feat: pre-commit-forkfile-exempt]`)。

## 决策轨迹

- **基准树选 `be227503af` 而非现有 `upstream-baseline` tag**:后者指 1.14.21(2026-04-23),用它会把上游 1.14→1.17 新增文件误判 fork 自建 → 闸变松。方案定稿时已核 `be227503af` = upstream/dev @ 1.17.4(`packages/opencode/package.json` version 核过)。
- **不复用/移动 `upstream-baseline` 老 tag**:它是历史同步起点快照,语义不同;另起 `upstream-base` 做「当前上游基准」滚动 tag,每次 sync 后移动(写进 merge guide §5.8)。
- **豁免判定放 hook 内动态算而非扩 `EXCEPTION_REGEX` 枚举**:实测 fork 自建文件 47 个且还在涨,枚举必然滞后(doc 点名的 `file-office.ts` 都已消失)。
- **`git cat-file -e` 离线可用**:tag 对象本地有,不依赖 fetch upstream(REQ-103 实测 fetch 5min 超时,不能依赖)。
- (施工中如有踩坑在此追加)
