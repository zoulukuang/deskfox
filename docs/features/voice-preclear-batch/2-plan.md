feat-id: voice-preclear-batch
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 语音派活前置清障批 — 2-plan(实施计划)

> 前提:1-spec 经 user 审签(Large),§6 四个待拍板项有结论。
> 分支:`feat/voice-preclear-batch`(已按铁律从最新 main 拉出)。
> 预计规模:单线程直接完成,0 子 agent;机器时间大头在 S2 的 3 轮全套(每轮约 20-40 min,可后台跑)。

## 0. 实施顺序及理由

**S3 → S4 → S1 → S2 → S5**,与计划原文的优先级排序(S1 最先)不同,理由:

- 本批不发版,S1 的「风险在累积」取决于**合 main 后何时随发版出去**,不取决于批内先后;批内顺序只优化流程。
- S3(~0.5h)先做:恢复 app 单测基线全绿,后面每一步的回归口径才干净(现状 `test:unit` 带着一个已知红)。
- S4(~1-2h)第二:两笔独立小 commit,做完即从回归噪声里消失。
- S1(~1-1.5 天)第三:本批核心交付,需要 user 已拍板 D1/D2。
- S2(~0.5-1.5 天 + 机器时间)第四:3 轮全套验证放批尾,顺便把 S1/S3/S4 的改动一起覆盖进回归。
- S5(~0.5h)收尾:归档按《需求管理规范》§D 必须等全批子项完成才触发。

每批一笔(或少数几笔)commit,P4 可逆,message 一律带 `[feat: voice-preclear-batch]`。

## 1. 第 0 步 · 基线快照(动工当天)

```bash
git log --oneline -1                      # 记录起点
cd packages/app && bun run test:unit      # 预期:仅 submit.test.ts 1 red(记录精确数字)
bun run typecheck                         # 预期 29/29
```

## 2. S3 · submit.test.ts(1 笔 commit)

1. `submit.test.ts` beforeAll 内补 mock:
   - `mock.module("@opencode-ai/ui/toast")` 增加 `toaster: { show: () => 0, dismiss: () => {} }`
     (+ 按 `utils/toast.tsx` 实际 import 清单补齐;`ToastOptions`/`ToastVariant` 是纯类型不需 stub);
   - 新增 `mock.module("@opencode-ai/ui/v2/toast-v2", ...)` 提供 `ToastV2`/`showToastV2`/`toasterV2`;
   - 若仍有下游具名导出坑,改策略为直接 `mock.module("@/utils/toast")`(submit.ts 只用 `showToast`)。
2. 验证:`bun test --conditions=browser --preload ./happydom.ts src/components/prompt-input/submit.test.ts`
   → **用例数 > 0** 且全绿;`bun run test:unit` 全量绿。
3. commit:`test(app): 补齐 submit.test.ts 的 toast mock 具名导出,恢复提交链路覆盖 [feat: voice-preclear-batch] [bug-repro: mock 缺 toaster 具名导出致加载即挂]`

## 3. S4 · i18n 两条(2 笔 commit,分开可各自 revert)

**S4a CRLF**:
```bash
# .gitattributes 追加:packages/app/src/i18n/*.ts text eol=lf
git add --renormalize packages/app/src/i18n
git diff --cached --stat        # 预期只有 da/de/no/tr 四文件
git diff --cached -w            # 预期为空(纯行尾)
for f in da de no tr; do file packages/app/src/i18n/$f.ts; done   # 纯 LF
```
commit:`chore(i18n): da/de/no/tr 行尾归一化 LF + .gitattributes 定向规则 [feat: voice-preclear-batch]`

**S4b 死 key**:
1. 以 1-spec §3-S4b 钉死的 23 key 清单为准写一次性脚本(scratchpad,不入仓),对
   `packages/app/src/i18n/*.ts` 全量删行;删前后统计各文件行数差,应一致(每文件 ≤23)。
2. 核对 `settings.feishu.*` 三行删除不破坏 `FORK-BEGIN/END` 配对(marker 行本身不动)。
3. 验证:23 key 全仓 grep 零命中;`bun run typecheck`;`bun run test:unit`。
4. commit:`chore(i18n): 清理 23 个零引用死 key(fileTree.dialog×20 + settings.feishu×3) [feat: voice-preclear-batch]`

## 4. S1 · 迁移污染检测(2-3 笔 commit;需 D1/D2 已拍板)

**T7 spike 先行(半小时,失败即停下重估)**:
local 包或 `electron -e` 验证主进程 `require("node:sqlite")` 可用、能只读打开一个 WAL 模式 db。
同时验证 bun test 下 `bun:sqlite` 造的测试 db 能被同一 IO 壳读(driver 注入口径)。

**commit 1 · 纯逻辑 + 基线生成**(Logic 清单,行覆盖 ≥80%):
1. `scripts/gen-migration-baseline.mjs`:读 `packages/core/src/database/migration/` 目录名 →
   生成 `packages/desktop/src/main/deskfox/migration-baseline.generated.ts`(66 id,提交入仓);
   同脚本实现 `--check-upstream`(拉上游仓 migration 目录清单对比,输出领先条数;网络失败输出
   「未检查成功」退出码 0 不阻塞)。ship SOP 增补一步跑它(实施时同步改 `~/.deskfox-signing/ship.md`,
   对应记忆 `preship-upstream-schema-drift-check`)。
2. `deskfox/db-schema-guard.ts`:`assessJournal(ids, baseline)`(判定规则见 1-spec §3-S1)。
3. 单测:R8 T1(五类输入)+ T2(drift 闸:生成物 vs 目录实时清单)。

**commit 2 · IO 壳 + 双点接线**:
1. `deskfox/db-schema-guard-io.ts`:只读读 journal(`migration` → fallback `__drizzle_migrations`;
   driver 注入,prod 用 `node:sqlite`,单测注入 `bun:sqlite`)+ `quarantineDb`(rename db+wal 为
   `.incompatible-<ts>`)。单测 R8 T3(四态含损坏文件)。
2. `data-namespace.ts`:迁移前判旧 db;ahead → copy filter 排除 `opencode*.db*`,marker reason 记
   `db-quarantined`。单测扩 `planNamespaceMigration` 层(R8 T4 unit 部分)。
3. 启动期接线:在 `applyDeskfoxDataNamespace` 现调用点之后、sidecar 拉起之前加检查
   (上游文件改动 ≤5 行 + FORK marker;toast 通知复用现有主进程→renderer 通知通道,实施时定点)。

**commit 3 · 真机验收脚本 + 实测**(R8 T4/T5/T6):
1. scratchpad 脚本造超前 db:copy 一份真实结构 db(或空库 `CREATE TABLE migration...`)+
   `INSERT INTO migration VALUES ('99991231235959_pollution_probe', ...)`。
2. 三场景实测(local 包 + XDG 指向临时目录全隔离,**只杀本地版进程**):
   - 迁移期:旧 ns 放超前 db → 首启 → 断言:新 ns 无 probe 行、auth/config 已迁、旧 db md5 无变、app 冷启动健康;
   - 历史遗留:新 ns 放超前 db + marker → 启动 → 断言:`.incompatible-*` 出现、空库起、toast 可见(截图);
   - 回归:正常 db 走一遍,行为与现在零差异。
3. 结果与截图记入 3-changelog。

## 5. S2 · performance 套件(2-3 笔 commit)

1. **验证并行度假设**(不改代码):
   ```bash
   cd packages/app && OPENCODE_PERFORMANCE=1 PLAYWRIGHT_WORKERS=1 bunx playwright test --reporter=list
   ```
   A 族转绿 → 坐实;不转绿 → 假设作废,回到逐条调查(2-plan 实时追加 note)。
2. **改跑法契约**:全量验收 = ① 默认套件 ② `bun run test:bench` ③ `bun run test:stability`
   (后两者自有 config 串行)。`OPENCODE_PERFORMANCE=1` 混跑口径废除或标注 debug-only。
   涉及:`playwright.config.ts` 的 `testIgnore` 注释/守卫、`AGENTS.md`/规范文档中的跑法说明。
3. **B 族逐条**:
   - `adverse:82`:读 spec + 虚拟化实现,定位卸载竞态点(一句话结论),再定修测试还是修行为;
   - `adverse:167`:local 包真机 resize 往返,肉眼 + CDP 截帧序列;闪 → 行为修复规模评估
     (超 Tiny 单开需求,本批放宽断言 + 挂链接);不闪 → 放宽断言写明依据;
   - `scroll-interaction.spec.ts`:新串行契约下先复测 3 轮;仍 flaky 逐条定位;处理不掉 → R5 显式移除 + changelog 理由。
4. **3 轮全套验证**(R8 T2,可夜间/后台跑):三步契约连续 3 轮,失败集为空或全部已记理由。
5. **规范收口**:按 D3 结论改《自动化测试规范》(performance 组定位 + 发版验收清单增补)。
6. commit 粒度:跑法契约 1 笔;B 族处理 1 笔;规范文档 1 笔(或并入前者)。

## 6. S5 · 归档 + 回填(1 笔 fork commit + OPENCODE-PLAN 若干)

1. fork:`stale-path-hardening/mac-qa-handoff.md` 待办 2 段改结论(指向
   `project-continuity-v2026-8-4/3-changelog.md` REQ-070 段)+ `1-spec.md:36` 勾选;
   commit:`docs(features): stale-path-hardening 真机 QA 结论回填(REQ-070 已验通) [feat: voice-preclear-batch]`。
2. OPENCODE-PLAN(全批完成时,按 §D):REQ-068 行迁 `需求归档.md`(按 D4 记 Win 残留)+
   doc 迁 `需求池/已完成/` + `bash scripts/check-index-sync.sh` 全项 OK + 该仓直接 commit+push(特例授权)。
3. 同时在 `需求计划/2026-08-18-语音派活前置清障.md` 填「交付记录」。

## 7. 收尾

1. 全批验收门槛逐项打勾(1-spec §5),3-changelog 落 commit 清单 + 行数 + 回退方法。
2. `本仓 改动日志.md` + `docs/features/INDEX.md` 补索引行。
3. **向 user 提 merge(铁律:合 main 必经同意;push 另行请示)**。

## 决策轨迹(开发中实时追加)

- 2026-08-18 立项,spec 待审签。
- 2026-08-18 user 拍板 D1/D2:按推荐(迁移期不迁超前 db + 启动期隔离挪走,含降级边界接受)。
- 2026-08-18 user 提议「发版前查上游数据库格式变化并做兼容」,讨论后细化为**信号制**:
  `gen-migration-baseline.mjs --check-upstream` 输出上游领先条数进发版报告,由 user 决定是否排
  REQ-103 式同步;不当场兼容、不阻断发版。已立记忆 `preship-upstream-schema-drift-check`。
- 2026-08-18 user 授权「计划开发文档收口」:D3/D4 按推荐采纳,四项拍板齐,spec 锁版;
  user 要求**正式开发前先通知**,开工令未下,本批停在文档态。
- 2026-08-18 开工,按 §0 顺序推进:**S3 ✅ → S4a ✅ → S4b ✅**。
  - S4a/S4b 均触发 pre-commit 500 行阈值,按机械改动性质走 `--no-verify` + `[large-diff: 理由]`
    标注(与本仓既有先例一致);S4b 的不可拆理由:同批 key 必须整批删,否则 `i18n/parity.test.ts`
    的 locale 一致性守卫必红。
  - S4b 实际删除量 62 locale × 23 key = 1426 行,与 1-spec §3-S4b 清单**逐条对齐,无增无减**。
  - 基线口径修正:2-plan §1 写的 typecheck「预期 29/29」为立项时快照,实际当前为
    **33/33**(包数增长),非回归。
- 2026-08-18 user 下开工令,**S1 完成(6 笔 commit)**。与计划的偏差与原因:
  - **T7 spike 通过**,`node:sqlite` 路线成立,未触发 better-sqlite3 回退分支。
  - **commit 数 3 → 6**:pre-commit 500 行阈值拦下,按 P4 拆成"判定逻辑 / IO 壳 / 迁移期 /
    启动期 / renderer / 验收脚本"六笔,每笔独立可编译可 revert。拆分顺序有硬约束 ——
    迁移期(产出 `quarantinedDbs` 字段)必须在启动期接线(消费该字段)之前,否则中间态编译不过。
  - **基线条数 66 → 38**:1-spec 数字与实际不符,按 `migration.gen.ts` 与目录实测取 38。
  - **`gen-migration-baseline.mjs` 落 `packages/branding/scripts/` 而非根 `scripts/`**:后者是
    pre-commit 黑名单(仅放行 install-hooks.sh),放进去要烧 R4 override 配额(每季仅 2 笔)。
    branding/scripts 有 `gen-tray-icons.py` 同构先例(同样生成到 desktop/src/main/deskfox/*.generated.ts)。
  - **`checkAndQuarantineAheadDb` 的 dbPath 改为调用方注入**:原计划复用
    `resolveSidecarDbPath`,但它的家 `db-orphan-prune.ts` 顶层 import 了 `node:sqlite`,
    bun 连 resolve 都做不到 → 引用它单测就整个加载不了。
  - **`applyDeskfoxDataNamespace` 增可选 opener 形参**:不注入的话 bun 测试环境永远走 fail-open,
    测不到真实判定行为(首次写完测试即撞,故补此形参)。
  - **真机验收踩两坑**(详见 3-changelog):隔离必须用 `HOME` 不能用 `XDG_DATA_HOME`
    (后者触发 same-dir 使整条逻辑被跳过,首轮 6 项误报);必须带 `--use-mock-keychain`
    (否则弹「找不到钥匙串」系统框打断跑批)。
- **遗留**:`--check-upstream` 接入发版 SOP 未做 —— 本机 `~/.claude/commands/ship.md` 当前不存在
  (只有 `ship.md.bak`),不擅自改 user 本机文件,待 user 确认接入方式。
- **下一步 S2(performance e2e 套件复活)**,预计 0.5-1.5 天 + 机器时间(3 轮全套可后台跑)。
