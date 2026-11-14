# REQ-149 前端两笔修复独立复核

执行：笑南的电脑 / Codex 子 agent，2026-11-14。审核提交 `865f66eda4`（查询键按内容比较）、`988736dcf8`（Git 元数据路径过滤）以及当前 `vcs-refresh-overload.spec.ts`。只读生产代码；仅新增本记录并修订 `4-ignore-design.md` 的 HEAD 处理建议，未提交。

## 发现：P2 — 根 `.git/HEAD` 不应被一律吞掉

`packages/app/src/pages/session/vcs-event.ts` 将根 `.git/HEAD` 判为需过滤，`session.tsx` 据此跳过刷新。后端 `packages/opencode/src/project/vcs.ts:320–335` 虽监听 HEAD，但只在 `git.branch()` 返回值改变时发布 BranchUpdated；detached HEAD 移动到另一提交后 branch 仍为 undefined，查询键也不变。

可复现触发：项目处于 detached HEAD，审阅面板已经显示；执行 `git reset --soft <前一提交>`。这个操作保留工作文件和 index，仅移动 HEAD，工作区相对 HEAD 的差异发生变化。新过滤吞掉 HEAD 文件事件后，没有另一个文件事件或分支名称变化来触发刷新，审阅内容可一直保持旧结果。此前绝对路径绕过过滤时会触发刷新，因此这是本次过滤带来的回归。

### 真实 Git fixture 证据

在独立 `TemporaryDirectory` 中创建两次提交：文件 `a` 从 `one` 改为 `two`，commit.gpgsign=false，core.excludesfile=/dev/null。对比操作前后的 `.git/HEAD` 内容和 `st_mtime_ns`，并运行 `git diff HEAD --stat`。

| 情形 | HEAD 文件是否变化 | 工作区相对 HEAD 的差异 |
| --- | --- | --- |
| 普通命名分支执行 soft reset | 否，仍为相同 `ref: refs/heads/main` | `a` 为 1 行增加、1 行删除 |
| detached HEAD 执行 soft reset | 是，内容从第二次提交 SHA 变成第一次提交 SHA | `a` 为 1 行增加、1 行删除 |

普通命名分支的 soft reset 未改变 HEAD 文件，是既有监听边界，不归为本次新增回归。detached 情形则有明确 HEAD 文件变化，新 helper 会丢掉它。实验未修改用户仓库，未声称完成产品 UI 或两端验证。

### 建议修复

- 归一化后只过滤无关 Git 元数据，**保留根 `.git/HEAD` 进入 `createVcsRefresh`**。现有刷新合并足以控制其并发，无需从这里新增 Git 查询。
- 未来忽略判定模块也应让 HEAD 直接通过，不传给工作文件 `check-ignore` 接口。
- 将 e2e 中“HEAD 不增加请求”的断言改成“HEAD 触发一次、挂起期间后续 HEAD 变化最多补刷一次”；增加 branch 不变的场景。单测覆盖 Mac / Windows / UNC 根 HEAD 例外与其他 `.git` 文件过滤。
- 这会细化原 spec T5 的“`.git/` 全部过滤”，以不丢有效差异更新为准，需回填 spec，不能继续将全部 HEAD 过滤写成验收要求。

主 agent 已收到此发现并接受修复建议；本次独立复核未修改生产代码。

## 其余检查

- 查询键：`hashKey` 与当前 QueryClient 的默认键语义一致，实际键为目录/分支/默认分支字符串；未发现该两行改动导致的阻断问题。内容相同数组保留待刷新、真实键变更丢弃旧待刷新符合目标。
- 生命周期：`@solid-primitives/scheduled` 的 debounce 在 Solid owner 上注册 cleanup；组件销毁可清定时器，effect 同时随 owner 销毁。当前调用点在组件内，未发现本次引入的卸载后刷新问题。新单测没有直接覆盖卸载，可按后续异步过滤测试一起补，非本两笔的阻断发现。
- 路径：Windows 盘符与 UNC 会统一分隔符及大小写，Posix 保留真实反斜杠、百分号与井号，不做 URI 解码。根边界采用 `root + '/'`，未把 `/repo-other` 或嵌套 `src/.git` 当成根元数据。未发现这些路径处理上的阻断回归。
- e2e：覆盖单请求挂起、事件合并、文件树展开与 question reply 成功；网络通过 mock route 控制，不等同真实 socket pool 压力、普通 prompt 提交或 Mac/Windows local 验收。新增 HEAD “零请求”断言需要按上述发现修正。既有单测真实 QueryClient 主要验证失效状态，并不单独证明 HTTP 并发；并发证据来自 e2e 与此前两端记录，各自边界应保留。

## 结论

发现上述一项 P2，需要修正后再将元数据过滤验收为完成。查询键修复未发现阻断问题。未运行重型测试；仅进行了短时真实 Git fixture，后续修复测试由主 agent 执行并补回执。

## 修复回执（笑南的电脑，主 Codex，2026-11-14）

已接受并修正：helper 改名 `shouldIgnoreVcsMetadata`，Mac/Windows/UNC 根 HEAD 保留刷新；其余 Git 元数据仍过滤。先补四条 HEAD 例外单测，旧过滤实现 15 pass / 4 fail；修后连查询键测试合计 25 pass / 0 fail。Playwright 现在断言 `.git/index` 不触发请求、branch key 不变的 HEAD 事件触发一次，并与后续 8 次文件事件合并补刷，1 pass / 0 retry。e2e typecheck 和完整 pre-push 再次通过（app 1222 单元，41 browser，其他范围不变）。该 P2 已在分支内关闭；真实两端 local 压力和普通 prompt 提交仍待后续。
