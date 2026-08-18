feat-id: voice-preclear-batch
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 语音派活前置清障批 — 3-changelog

> 施工中(spec 已收口锁版,2026-08-18)。每批 commit 后按规范填:实际改动 / commit hash /
> 行数 / 影响范围 / 回归测试 / 回退方法。
>
> 批次进度:**S3 ✅ / S4a ✅ / S4b ✅ / S1 ✅(6 笔,含真机实测)** → S2 ⬜ → S5 ⬜

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

### S1 · REQ-084① 迁移污染检测(6 笔,2026-08-18)

**T7 spike 先行**(施工第一闸,失败则回退评估 better-sqlite3)—— 结论:**通过,无需回退**。
Electron 42.3.3 / Node 24.15.0 主进程 `require("node:sqlite")` 可用;只读打开 WAL 库能读到
**全在 -wal 里**的数据(主库 4KB 空、WAL 45KB);写入被拒(`attempt to write a readonly database`),
保证检测绝不写坏用户 db;bun:sqlite 造的库能被 node:sqlite 读通 → driver 注入口径成立。

| # | commit | 内容 | 行数 |
|---|---|---|---|
| 1 | `f26633f556` | 判定逻辑 `assessJournal` + 基线生成脚本 + 生成物(38 条) | +325 |
| 2 | `1f064d8e2f` | IO 壳:只读读 journal + 隔离挪档 | +290 |
| 3 | `618b9f0e33` | 迁移期检测:超前 db 不迁入新 ns(D1) | +200 / -6 |
| 4 | `cff46a3a65` | 启动期自愈:ns 内超前 db 隔离挪走(D2)+ 双点接线 | +306 / -1 |
| 5 | `7bd894ffb5` | renderer 侧告知用户数据去向(toast) | +110 |
| 6 | `6abebf8be2` | 真机验收脚本(三场景 + toast 可见性) | +405 |

**判定规则**:只看 `^\d{14}_` 时间戳形态 id;legacy(core 从 `__drizzle_migrations` seed 来的)
一律忽略 —— 否则老库全员误报。读不出 journal / 空库 / 损坏文件一律 `unknown` 走 **fail-open**:
检测本身绝不能把好库拦下来,只有拿到"基线外时间戳 id"这一正向证据才判 `ahead`。

**上游侵入**:仅 `main/index.ts` 一处 FORK-BEGIN/END 包 11 行(R1 第 2 级);
其余全是 `deskfox/` 下 fork-only 新文件。preload 是通用 invoke,零改动。

**实际改动清单**:
- 新增 fork-only:`db-schema-guard.ts` / `db-schema-guard-io.ts` / `db-schema-startup-check.ts` /
  `db-quarantine-notice.ts` / `migration-baseline.generated.ts`(desktop 主进程);
  `utils/db-quarantine-notice.ts` + `components/db-quarantine-monitor.tsx`(app renderer);
  `branding/scripts/gen-migration-baseline.mjs` + `verify-db-schema-guard.sh` +
  `branding/smoke/req084_toast_verify.py`。
- 修改:`deskfox/data-namespace.ts`(迁移期接线,fork-only)、`deskfox/ipc.ts`(注册 1 个 handler)、
  `main/index.ts`(上游,11 行)、`app.tsx`(上游,2 行挂载)。

**回归测试**:单测 +50 例(T1 14 / T3 16 / T5-unit 9 / T4-unit 6 / 通知与文案 10);
desktop 168 pass、app 1051 pass、typecheck 33/33,全 0 fail。

**真机实测**(REQ-084 原文要求"造超前 db 实测",不接受只写单测)—— local 包 arm64,**12 通过 / 0 失败**:
- **T4 迁移期**:超前 db 未迁入(新 ns 干净)、auth.json/storage/config 全部迁入、
  旧 ns 原库 md5 未变、marker 记 `reason=db-quarantined`。
- **T5 历史遗留**:隔离为 `opencode-local.db.incompatible-<ts>`,与原库**逐字节一致**,
  原位置是干净新库;**toast 真机可见**(CDP 查 DOM + 截图 `smoke/_shots/req084-quarantine-toast.png`),
  文案含「已另存备份」「文件没有被删除」+ 找回路径。
- **T6 回归**:正常库不被隔离、仍在原位、库内数据完好 —— 无误伤。

**两个踩坑(已写进脚本注释防重蹈)**:
1. **真机隔离不能用 `XDG_DATA_HOME`**。`resolveDeskfoxXdg` 的设计是"用户显式设了 XDG 就尊重",
   一设新旧命名空间即算同一目录(`same-dir`)→ 迁移与隔离逻辑整条被跳过,跑出来全是假象
   (首轮 6 项误报即此因)。必须设 `HOME` 走真实默认路径推导。
2. **必须带 `--use-mock-keychain`**。HOME 改后 macOS 钥匙串路径跟着变,app 找不到自己的条目会弹
   「找不到钥匙串」系统对话框打断无人值守跑批。已实测确认该弹窗只是"找不到",钥匙串内无任何写入。

**与 spec 的出入**:1-spec §3-S1 写「66 个 migration」,实测 `migration.gen.ts` 与目录均为 **38 条**,
已按实际取数(spec 锁版后只补不改,此处记录)。

**遗留待办**:`gen-migration-baseline.mjs --check-upstream` 尚未接入发版 SOP。
本机 `~/.claude/commands/ship.md` 当前不存在(只有 `ship.md.bak`),状态待 user 确认后再接。

## 回退方法

每批一笔独立 commit,P4 可逆,可单独 `git revert`:

| 批次 | commit | 回退命令 |
|---|---|---|
| S3 | `269e1f0bbb` | `git revert 269e1f0bbb` |
| S4a | `ecf0b79a2d` | `git revert ecf0b79a2d` |
| S4b | `8a9bcbb63a` | `git revert 8a9bcbb63a` |
| S1 | `f26633f556` … `6abebf8be2` | 见下方说明 |

**S1 整条回退**:按**逆序** revert 六笔(`6abebf8be2` → `7bd894ffb5` → `cff46a3a65` →
`618b9f0e33` → `1f064d8e2f` → `f26633f556`)。也可只回退单笔:
- 只想关掉启动期自愈 → revert `cff46a3a65`(迁移期检测仍在);
- 只想关掉 toast → revert `7bd894ffb5`(检测与隔离照常,只是不提示用户)。
回退后行为回到「超前 db 照迁 / 不自愈」的原状,**不会**留下半截状态。

注:S4a(行尾)与 S4b(删 key)同改 i18n 文件,**若要同时回退,按逆序** revert
(先 S4b 后 S4a),否则行尾规则撤销后 S4b 的删除 hunk 可能对不上。
