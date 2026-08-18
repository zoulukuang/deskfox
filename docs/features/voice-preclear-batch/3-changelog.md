feat-id: voice-preclear-batch
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 语音派活前置清障批 — 3-changelog

> 施工中(spec 已收口锁版,2026-08-18)。每批 commit 后按规范填:实际改动 / commit hash /
> 行数 / 影响范围 / 回归测试 / 回退方法。
>
> 批次进度:**S3 ✅ / S4a ✅ / S4b ✅** → S1×3 ⬜ → S2×2-3 ⬜ → S5 ⬜

## 交付记录

### S3 · submit.test.ts toast mock 修复(`269e1f0bbb`,2026-08-18)

- **改动**:`packages/app/src/components/prompt-input/submit.test.ts` +12 行(1 文件)。
  在真实依赖边界 mock toast,补齐具名导出。
- **起因**:单独跑该文件报 `Export named 'toaster' not found`,加载即挂。
- **影响范围**:仅测试文件,不触碰产品代码。
- **回归**:修前 0 pass / 1 fail → 修后 8 pass;app `test:unit` 基线恢复全绿。
- **回退**:`git revert 269e1f0bbb`(恢复到该测试单独跑即挂的状态)。

### S4a · i18n 行尾归一化 LF(`ecf0b79a2d`,2026-08-18)

- **改动**:`.gitattributes` +6 行(`packages/app/src/i18n/*.ts text eol=lf` 定向规则)+
  `da/de/no/tr` 四个 locale 文件 CRLF→LF 全文重写(5738 插入 / 5732 删除,共 5 文件)。
- **影响范围**:纯行尾字节,`git diff -w` 为空,**零内容改动**。
- **回归**:typecheck 绿;`file` 确认四文件纯 LF。
- **commit 标注**:`[large-diff: 纯行尾 CRLF→LF 机械归一化,按文件无法再拆]`。
- **回退**:`git revert ecf0b79a2d`(四文件回到 CRLF,`.gitattributes` 规则一并撤销)。

### S4b · 清理 23 个零引用死 key(`8a9bcbb63a`,2026-08-18)

- **改动**:62 个 locale 文件各删 23 行,**1426 行删除 / 0 新增**。
- **删除清单**(1-spec §3-S4b 钉死,删前逐一核实零引用):
  - `fileTree.dialog.*` 20 个:`newFile.{title,label,placeholder}` /
    `newFolder.{title,label,placeholder}` / `rename.{fileTitle,folderTitle,label,confirm,unchanged}` /
    `confirmDelete.{fileTitle,folderTitle,bulkTitle,messageSingle,messageBulk,bulkName,detail,confirm}` /
    `create`;
  - `settings.feishu.*` 3 个:`bind.domain.label` / `bind.userCodeLabel` / `edit.cancel`。
- **未误删**:`fileTree.dialog.cancel` / `fileTree.dialog.validation.*` 等仍在用,保留。
- **FORK marker**:`en/zh/zht` 各 5 对 BEGIN/END,删行前后数量不变、配对完整
  (`settings.feishu.*` 三行在 FORK 块内,marker 行本身未动)。
- **回归验收**:
  - `git grep` 23 key 全仓(追踪文件)**零命中**;
  - `bun run typecheck` **33/33 绿**;
  - app `bun run test:unit` **1045 pass / 0 fail**(含 `i18n/parity.test.ts` locale 一致性守卫)。
- **commit 标注**:`[large-diff: 同批 key 必须整批删否则 i18n parity 测试红,按文件/按 key 拆均不成立]`。
- **回退**:`git revert 8a9bcbb63a`(23 个死 key 原样回到 62 个 locale 文件)。

## 已知边界(预留,交付时补实录)

- **(S1 / D2 拍板接受)** updater `allowDowngrade=true` 下,用户降级后自家新 db 会被启动期检测判超前并
  隔离挪走(`opencode.db.incompatible-<ts>`,保留可手动恢复)—— 把「静默永久坏」换成「显式隔离」,
  设计内行为,非 bug。

## 回退方法

每批一笔独立 commit,P4 可逆,可单独 `git revert` 且互不依赖:

| 批次 | commit | 回退命令 |
|---|---|---|
| S3 | `269e1f0bbb` | `git revert 269e1f0bbb` |
| S4a | `ecf0b79a2d` | `git revert ecf0b79a2d` |
| S4b | `8a9bcbb63a` | `git revert 8a9bcbb63a` |

注:S4a(行尾)与 S4b(删 key)同改 i18n 文件,**若要同时回退,按逆序** revert
(先 S4b 后 S4a),否则行尾规则撤销后 S4b 的删除 hunk 可能对不上。
