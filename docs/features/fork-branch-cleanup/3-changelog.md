feat-id: fork-branch-cleanup
status: done
related: ./3-changelog.md

# 自有分支清理（2026-11-14）

接手中（笑南的电脑，Codex，2026-11-14）。用户授权先备份，再清理已完成和重复的自有分支；核对分享、附件保护的独有草稿；保留语音和 REQ-149；上游相关引用不动。

备份目录：`/Volumes/ExtSSD/software/Codex/backups/deskfox-cleanup-20261114-122100/`。
已保存本地分支完整 Git bundle、所有工作树 HEAD/状态/二进制补丁/未跟踪文件及 SHA-256 清单；bundle verify 和归档文件校验通过。

本分支仅承载清理回执。主干合并/推送仍交李哲。

## 回执（笑南的电脑，2026-11-14）

### 备份与恢复验证

- local-branches.bundle 保存清理前全部 10 个本地分支及完整可达历史；refs-before.txt 保存清理前全部引用。
- 每个现存工作树保存 HEAD、状态、tracked/staged 二进制补丁、改动和未跟踪文件 tar、SHA-256 清单。主工作树两处品牌说明及旧基线锁文件也已备份。
- bundle verify 通过；从 bundle 克隆 restore-check.git 并执行 fsck --connectivity-only 通过。tar 内每个文件均按 SHA-256 回读验证。
- 六个被移除登记的工作树完整移入备份目录 worktree-archives/，包括忽略文件、依赖、测试日志和构建产物；原工作树管理信息保存在 worktree-registration/。
- README.md 记载恢复步骤；cleanup-actions.json 记载原路径、归档路径和分支头。备份位于本机外置 SSD，未上传私有日志，不等同于异地备份。

### 分支处理

| 本地分支 | 原头 | 结果 |
| --- | --- | --- |
| attachment-guard | 6484170318 | 草稿核对后完整归档，删除分支；功能仍 on-hold |
| share-routing | b2162c0c7d | 草稿核对后完整归档，删除分支；不重提旧实现 |
| collab-verification | d3f695df3d | 重复回执，删除本地与 GitHub 分支；额外证据已在主干交接中 |
| mac-onboarding | dd9356dd63 | 已在 main 历史，删除本地分支 |
| feat/mac-collab-round2 | c90ce9d03e | 已在 main 历史且远端已删，删除本地分支及失效 origin 跟踪引用 |
| release-handoff | 6926dc136a | 已在 main 历史且远端已删，删除本地分支 |
| feat/voice-dispatch-minimal | 968504e564 | 已完全被 voice-acp-bridge 包含，bundle 保存后删除较早分支 |
| feat/voice-acp-bridge | 334ce3382d | 保留原头，完整历史另在 bundle 和恢复验证仓；本次未推送未经现行测试的旧代码 |
| fix/deskfox-vcs-refresh-overload | da1afba056 | 保留原头及 origin 分支，仅清除不存在的临时工作树登记 |

发布 tag、发布打包工作树、旧基线、batch-local 保留。主干仍为 51739ad376，其两处原有品牌说明改动保留且已备份。新增 feat/fork-branch-cleanup 仅承载本回执，待李哲合入主干后销毁。上游相关分支及 PR 分支不在处理范围。

### 草稿核对结论

逐文件比较主干、双端 12.0 / 12.1 tag，以及 aabf42e730、af056a70c7、d7ccd4718a、49442977bc、94a27bebcd、b26f855951 等相关提交。附件 41 个文件中 35 个匹配发布或历史版本；分享 78 个中 70 个匹配发布或历史版本。余下 6 / 8 个文件逐项核对如下。

#### 附件保护（6 个未完全匹配的文件）

| 文件 | 与已提交实现的差异 | 处理 |
| --- | --- | --- |
| bun.lock | 草稿缺后来补的 enterprise branding 依赖、Happy DOM 补丁，另有依赖排序差异 | 保存旧草稿，不回灌 |
| docs/features/INDEX.md | 早期施工状态，早于合并及 12.1 撤出决定 | 以当前 on-hold 为准 |
| docs/features/attachment-cost-guard/3-changelog.md | 缺 10-12 原生补测及 10-13 合并复核记录 | 旧快照归档 |
| packages/app/src/context/language.tsx | 相对实现提交只少两处 FORK 注释 | 不补入 |
| packages/app/src/pages/session/timeline/observe-element-offset.test.ts | 少 Happy DOM 强制 GC 回归触发 | 不用旧测试覆盖较新测试 |
| 改动日志.md | 仍写待审签，缺合并与分享记录 | 旧快照归档 |

附件 e2e 草稿可在 aabf42e730 / d7ccd4718a 找到完全相同内容。没有发现遗漏的新功能；附件功能恢复仍需单独评审，不能因清理将 12.0 行为带回 12.1。

#### 分享（8 个未完全匹配的文件）

| 文件 | 与已提交实现的差异 | 处理 |
| --- | --- | --- |
| bun.lock | 草稿缺 Happy DOM 补丁，另有排序差异 | 不覆盖当前依赖 |
| docs/features/INDEX.md | 仍标未提交、未部署的早期状态 | 保存旧快照 |
| packages/app/src/context/language.tsx | 独立分享分支未集成附件字典；与组合提交的集成差异 | 不作为新增功能回灌 |
| packages/opencode/test/share/share-next.test.ts | 少首次发布响应体挂起的总期限回归测试，另有空行 | 不用旧测试覆盖较新测试 |
| 改动日志.md | 未提交的早期施工记录 | 保存旧快照 |
| docs/features/share-routing/3-changelog.md | 少接管验收与合并复核记录 | 保存旧快照 |
| packages/enterprise/deskfox-deploy/README.md | 仍称仅准备、未部署；已提交文档已有两站部署事实 | 不回灌旧状态 |
| packages/enterprise/test/deskfox/repository.test.ts | 少取消遇磁盘空间/权限故障后恢复重试的回归测试 | 不用旧测试覆盖较新测试 |

maintenance、schema、api test 等其他未匹配发布 tag 的文件，在分享历史实现提交中有完全相同版本。没有发现需要从旧工作树补入主干的新功能，无需为清理修改产品代码。

### 验证与边界

清理前在主仓用 Bun 1.3.14 执行完整 .husky/pre-push，退出 0：29/29 typecheck；app 1197+41、media-gen 140、feishu 792、branding 82、desktop 176、session-ui 125 全部通过。branding 原有 8 项平台/环境 skip，未人为新增 skip。日志保存在备份目录 pre-push.log。

GitHub 删除 collab-verification 使用明确旧头的 force-with-lease，防止覆盖并发推进。已手动通过完整 pre-push，删除引用时用 HUSKY=0 避免重复执行；本回执为 docs-only，推送按现有例外跳过产品测试，提交信息写明。没有为语音或 REQ-149 声称通过新验收，没有将其合入主干。

GitHub 为分支清理唯一写入远端，Gitee 按现有镜像机制同步，不手动推 Gitee。最终回读两端 collab-verification 均已不存在，main 和 REQ-149 均保持原头。清理前后全量本地引用对比，除本次明确处理的自有分支及回执分支外均不变；GitHub 其他分支也逐一与清理前引用核对一致。上游、上游 PR 分支和发布标签保持原样。

另在备份内的独立 Git 仓分别从 bundle 检出两个原分支头，应用 tracked.patch 并恢复 draft-files.tar：附件 41 个文件、分享 78 个文件的 SHA-256 及完整 Git status 均与清理前一致。恢复结果保存在 restore-result.txt。
