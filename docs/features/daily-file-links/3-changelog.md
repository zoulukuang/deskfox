feat-id: daily-file-links
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 文件链接与查看修复

## 接手（笑南的电脑，Codex，2026-11-14）

接手中（笑南的电脑，Codex 子 agent `file_links`，2026-11-14）。用户批准六项迭代范围并授权并行开发；本会话独占 REQ-152、REQ-146、REQ-160、REQ-162 的共同入口。

- 代码位置：`fix/daily-file-links`，从最新 `main=fc96b0b5b5` 创建；独立工作目录 `daily-file-links`。
- 已验：只读确认共享 Markdown 点击处理器；尚未修改代码或运行产品测试。
- 剩余：施工 spec/R1/R8；先修编码与锚点，再完成项目外预览和各模型通道文件链接约定。
- 验收：按本批计划 T05–T12 和本 feat spec，实际看到内容；Mac/Windows local 与真模型抽查分别留证，不以单元测试替代。
- 边界：不改 main、不发布、不改规划仓。Large/R4 具体方案交主 agent 汇总审签，不把范围许可当成 override。

本笔仅登记接手：diff 检查与 pre-commit，按 docs-only 例外跳过全量 pre-push 产品测试。

## A：编码与章节导航（笑南的电脑，2026-11-14）

先在共享 handler 新增复现：原实现 10 pass / 12 fail，分别命中编码字面路径、编码越界、片段混入文件名和锚点原生导航。修复后相关测试为 26 pass / 0 fail（67 断言）。旧 U2「原生处理锚点」断言按 REQ-146 有意改为「缺失锚点也阻止整页导航」，并新增真实容器内定位断言；其余旧测试保留。

- `md-link-click.ts`：分离片段后单次解码，解码后再检查项目边界；纯锚点在当前 Markdown 容器滚动；成功打开文件时传递一次性章节请求。
- 新 `md-fragment.ts`：等待目标 root/path 的 Markdown DOM，只在激活查看器定位；消费后清除，卸载取消，MutationObserver 随 Solid scope 释放。无任意短超时，不因慢加载丢掉跳转。
- `file-tabs.tsx`：4 行 FORK 注入（import/comment/call），接入延迟章节定位；未改底层 Markdown/UI renderer。
- 测试覆盖空格、中文、字面百分号、单次解码、编码点段/分隔符越界、Windows 盘符、中文和 sanitize 前缀锚点、同名 ID 消息隔离、延迟 DOM、不同文档/项目、卸载与激活态。

首轮完整 `.husky/pre-push` 通过：29/29 类型检查；app 1212 unit + 41 browser、media-gen 140、adapter 792、branding 82、desktop 176、session-ui 125。之后补激活态保护与第 26 条测试，push 再跑完整闸；结果另补回执。GUI、Mac/Windows local、历史成品及真模型抽查尚未执行，不标 done。

事后清单：与 A 预清单一致，改 2 个 fork 文件+新增 2 个 fork 文件/测试、上游查看器 4 行注入及本日志。无新依赖、无黑名单、无顺手改、无未理解代码、未使用批量替换。A 可整体 revert；B/C 尚未实施。

### A 浏览器回归补验

`04226381b7` 已推送，push 闸 29 类型检查、app 1213+41、其他包全部通过。追加 `daily-file-links.spec.ts` 使用现有经典布局 harness，真实点击聊天编码链接并检查文档内容和章节进入视口、目录来回跳转、缺失目录不离开会话。

首轮 GUI 失败：文件内容正确但章节未进入视口。诊断发现首次 FileTabContent 在 Suspense 中被销毁时，尚未运行的章节 effect 没有接手请求，却被 cleanup 提前取消。改为只有实际等待该请求的查看器可取消。删除诊断日志后该 GUI 用例通过（Chromium，2.3 秒，retries=0），补充首次挂载销毁单测，相关单元/DOM 合计 27 pass / 0 fail（68 断言），`bun run typecheck:e2e` 通过。

测试只在网络/native fixture 上跑真实前端，不能代替两端 local。native fixture 只允许 `guide space.md` 存在性探测；编码错误或片段混入路径不能假阳性。没有 retry 掩盖失败、没有放宽入视口断言。

### A 路径 API 端到端复核

父 review 发现 handler 正确解码后，`file.tab → pathFromTab → loadFile/normalize` 仍把原始文件名当 URL 重复解码/去片段。新增实际 path helper 复现先为 44 pass / 3 fail：`report%20draft.md` 打开成空格同名文件，`#`/`?` 文件名被截断。修为只对 `file://` tab URL 解码与剥 query/hash；普通文件路径保持原文。审计 file context 各 normalize 调用均接原始文件列表、tab 还原路径或显式 file URL。

修后路径 helper 47 pass；Chromium 新用例同时放置 `%20` 与空格同名文件、以及截断名称文件，逐个点击编码链接，断言显示完整真实文件名对应内容。A 两条 GUI 均通过。变更限定 `context/file/path.ts` 的单处小注入、其测试和现有 GUI；该 app 路径不在当前黑名单内。没有用回调前重新编码掩盖重复 normalize。
