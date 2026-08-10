feat-id: fork-param-merge-guard
status: done
related: ./3-changelog.md

# fork 关键参数防上游 merge 丢失(REQ-104)

> 规模:**Tiny**(3 文件 / 净增 ~60 行,其中绝大部分是注释与文档)。按规范 v2 只写 3-changelog,省 1-spec / 2-plan。
> 需求出处:OPENCODE-PLAN `需求池/fork关键参数防上游merge丢失.md`(REQ-104)+ `需求计划/2026-08-09.md`(上游同步前置批)。
> 上位背景:本条是 **REQ-103(opencode 上游同步到 1.18.x)的前置项** —— 它保护的是 REQ-103 的验收手段本身。

## 背景

`packages/app/package.json` 的 `test:unit` / `test:unit:watch` 带 `--conditions=browser`,由 fork commit `defc4fe3ea`(REQ-072 修复)引入。缺了它,bun 会把 solid-js 解析到 **server 构建**,`createEffect` 变 no-op、effect 不执行。

而这一行几乎必然被上游 merge 撞到(`UPSTREAM-MERGE-GUIDE` §4.4 把 `package.json` 列为"几乎每次 merge 都有"的机械冲突),JSON 又写不了注释、没有 `FORK marker` 载体 —— 解冲突的人取上游版本就把它丢了。

## ⚠️ 实测更正:立项时的"静默假绿"说法不准确

REQ-104 立项时(及其上游来源 `发版工具链-2026.8.4-回顾待修清单` §5)的表述是「丢掉参数 = 静默假绿」。**2026-08-09 本次施工中实测,该表述不成立**:

| 条件 | 全量 app 单测结果 |
|---|---|
| 带 `--conditions=browser` | **606 pass / 0 fail** |
| 删掉该参数 | **604 pass / 2 fail** |

两条 fail 都在 `src/pages/layout/project-restore.test.ts`,报 `expect(t.opened).toEqual([DIR_A])` 收到 `[]` —— 即 effect 确实没跑。**所以是有信号的,不是无声。**

**但本条改动依然必要,理由改为"信号误导 + 信号脆弱"**:

1. **归因误导(主要理由)** —— 报错内容 100% 指向 project-restore 的业务语义(`REQ-072 折叠竞态:boot 完成后条目缺失 → 补回`),**零线索指向 `package.json` 参数**。解冲突的人最可能的反应是去调试(甚至"修")那段业务代码,而不是回头看 package.json。
2. **信号脆弱** —— 它只挂在**一个 fork-only 测试文件**上。`project-restore.test.ts` 一旦被重构或删除,信号归零。
3. **易被淹没** —— 只占 2/606。merge 后若本来就有其它 fail(参见 REQ-105 Windows 单测基线),这两条会混在噪音里。

⇒ 本改动的真实价值 = 把「两个业务测试莫名其妙红了」换成「一行明确说清参数丢了」。

## 实际改动

### 1. `.husky/pre-commit` — 新增 §4.6 fork 关键参数守卫(机器锁,唯一不依赖人的一道)

无条件跑(不只在该文件 staged 时,因为参数可能在任何一笔 commit 里被丢掉)。检查 `GUARDED_SCRIPTS`(当前 `test:unit` / `test:unit:watch`)是否都含 `--conditions=browser`;脚本整条消失也算违规。命中即 `exit 1`,并把上面那段"为什么报错不会告诉你真因"的背景直接打在终端上。

加新受守护参数时在 `GUARDED_SCRIPTS` 追加即可。

### 2. `packages/app/package.json` — 加顶层 `_fork_notes` 键(就地锁)

bun / npm 忽略未知顶层键。内容说明参数用途 + 实测数据 + 指向 merge guide。让解冲突的人在**打开这个文件时**就能看到,不必先去读治理文档。

### 3. `docs/governance/UPSTREAM-MERGE-GUIDE.md` — merge 前/后各加一条 checklist(流程锁)

- **§3.6(merge 前)**:抄下受守护参数当前值,供 merge 后比对;附高危项说明。
- **§5.7(merge 后)**:与 §3.6 比对。**并加了反向用法** —— merge 后若 `project-restore.test.ts` 报 effect 没生效,**先查这个参数,别急着调业务代码**。这条是本次实测的直接产物,也是最可能真正救人的一句。
- §6 自动化辅助表格里 `install-hooks.sh` 的能力描述补上 §4.6。

## 验证

| 验证项 | 结果 |
|---|---|
| 参数完好时跑 hook | ✅ 通过(五项检查) |
| 故意删 `test:unit` 的参数后跑 hook | ✅ **exit 1**,精确报出 `test:unit —— 缺 --conditions=browser` |
| 恢复后跑 hook | ✅ 重新通过 |
| `_fork_notes` JSON 合法性 | ✅ `require()` parse OK |
| `bun install` | ✅ `Checked 2541 installs across 2847 packages (no changes)`,无报错、lock 无变化 |
| `bun run test:unit`(app 全量) | ✅ 606 pass / 0 fail |
| `bun turbo typecheck --filter=@opencode-ai/app` | ✅ 1 successful |

对照实验(删参数 → 604 pass / 2 fail)见上文"实测更正"段,即本条改动的事实依据。

## 影响范围

- **运行时:无。** 三处改动分别是 git hook、package.json 的一个被工具链忽略的顶层键、治理文档。不触及任何产品代码路径。
- **黑名单:未触发 override。** `packages/app/` 不在 `.husky/pre-commit` 的 `BLACKLIST_REGEX` 内(黑名单是 `^package\.json$` 根级 + `packages/(…|opencode|ui|web…)/`);仓根 `docs/` 亦不在(黑名单指 `packages/docs/`);`.husky/` 不在黑名单。**断言脚本刻意没放 `scripts/`** —— 那才是黑名单(仅豁免 `install-hooks.sh`)。
- **测试纪律 R5:** 本条属"配置 / docs / Tiny(<50 行代码)"例外,不强制新增测试用例;但验收本身是真实触发的对照实验(删→红、恢复→绿),已实跑。

## 回退

```bash
git revert <本次 commit>
```

三处改动互相独立,也可单独回退任一处。回退后仅回到"丢参数只会得到 2 个误导性 fail"的原状态,无其它副作用。

## 关联

- **REQ-103** opencode 上游同步到 1.18.x —— 本条是其前置项
- **REQ-105** opencode Windows 单测基线复核 —— 同批前置(见 OPENCODE-PLAN `需求计划/2026-08-09.md`)
- 参数原始引入:commit `defc4fe3ea`(REQ-072 项目「关闭」失效修复)
- 上游来源清单:OPENCODE-PLAN `需求池/发版工具链-2026.8.4-回顾待修清单.md` §5(该清单其余 4 项与本条无关,仍留原处)
