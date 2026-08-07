feat-id: chat-tilde-del-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动日志 — REQ-098 单波浪号误判删除线

**规模**:Medium(新增 4 文件,改上游 2 文件各 ~4 行)
**分支**:`feat/small-cost-cleanup-batch`
**commit**:`96c9e50ddf`(R4 override,user 2026-08-07 审批通过)
**R4 override**:**需要**(`packages/ui/` + `packages/web/` 整包在 pre-commit 黑名单)—— 论证见文末

## 实际改动

| 文件 | 改动 | 行数(约) |
|---|---|---|
| `packages/ui/src/context/marked-del-strict.ts` | 新增(fork-only):`STRICT_DEL_RE` + `strictDelExtension`,含"必须返 undefined"陷阱注释 | +40 |
| `packages/ui/src/context/marked.tsx` | `marked.use(...)` 参数列表插入 `strictDelExtension` + import,带 FORK marker | +6 |
| `packages/web/src/components/share/marked-del-strict.ts` | 新增:ui 那份的逐字副本(仅互指注释一行不同) | +40 |
| `packages/web/src/components/share/content-markdown.tsx` | `markedWithShiki = marked.use(...)` 插入 `strictDelExtension` + import,带 FORK marker | +5 |
| `packages/ui/src/context/marked-del-strict.test.ts` | 新增:19 测(bug-repro / 不回归 / 无效用例固化 / 陷阱反例 / 防漂移守卫) | +140 |
| `packages/app/e2e/regression/chat-tilde-del-v2026.8.7.spec.ts` | 新增:前端界面 e2e(真实渲染链路,mock server → 时间线 → markdown) | +85 |

## 根因与修法

GFM 内置 del tokenizer 定界符是 `~~?`(一或两个 `~`),同一行两个「数字~数字」区间即被闭合成 `<del>`。收紧成只认 `~~`,其余前后瞻断言逐字保留内置规则(最小差分)。

**两处都改**:`marked.use()` 作用于各自模块实例,ui 的改动不会传导到 web share 页;web 不依赖 `@opencode-ai/ui`,不为一个 tokenizer 建跨包依赖 → 两份逐字副本 + 守卫测试防漂移。

**陷阱**:非匹配必须返 `undefined`。marked 的覆盖包装是 `c === false && (c = 内置(...))`,返 `false` 会回退内置规则 = 完全没改。已把"返 false 的反例"固化成测试用例。

## 影响范围

- 桌面聊天 + 文件 markdown 预览(同一 `MarkedProvider` 实例)+ web share 分享页。
- 单个 `~` 的其他用法(`~/path`、`~5%`、单区间)**修前本来就不会被划**,行为无变化(已用 BEFORE 断言固化,防后人拿它们当验收用例)。
- `~~删除~~` 路径与修前**位元一致**(测试直接断言 `after(src) === before(src)`)。
- 未动 `packages/desktop/src/main/markdown.ts`(marked ^15):经复核对聊天渲染是死路径。

## 回归测试

| 项 | 结果 |
|---|---|
| `bun turbo typecheck --filter='!./packages/console/*'` | 22/22 ✅ |
| `packages/ui` 全量 `bun test src` | **52 pass / 0 fail** |
| `packages/app` 全量单测 `bun run test` | **606 pass / 0 fail** |
| 新增单测(19) | 全绿;含 3 组 bug-repro 的 BEFORE/AFTER 对照 |
| **前端界面 e2e**(Playwright,真实渲染链路) | ✅ 1 passed |
| e2e 反证(撤掉修复后重跑) | ✅ 1 failed,实测抓到 `预计在 4.80<del>5.05 区间内震荡,突破 5.20</del>5.35 的概率低` |
| web share 页接线 | `bun build` 转译通过,产物中 `marked.use(strictDelExtension, …)` 首参正确 |

## 打包产物验证

`packages/desktop/out/renderer/assets/main-*.js` 内含收紧后的正则 → 修复确实进了打包后的渲染器。
所有产 HTML 的路径都走 `ui/context/marked.tsx` 的单一 parser 实例(`useMarked()` 经 context 下发);
`markdown-stream.ts` 虽直接 import marked,但只用 `marked.lexer` 做代码围栏切块、不产 HTML,不受影响。

**未做**:在打包后的桌面 App 里点开一条含该文本的真实会话做肉眼确认 —— 需要真发一次 LLM 请求或改动 user 的真实项目数据,收益低于成本。前端界面 e2e 已覆盖同一渲染链路且被反证有效。

## 回退方法

`git revert <commit>`(一笔含两包改动)。回退后恢复内置 `~~?` 行为。

---

## R4 override 复核报告(single-person 二次确认用)

**① wrapper 替代不可行性**
marked 的 tokenizer 覆盖必须经 `marked.use()` 注册进**该模块实例**;两处 parser 实例分别在 `ui/src/context/marked.tsx` 与 `web/.../content-markdown.tsx` 内部构造,外部没有注入点(`MarkedProvider` 只暴露 `nativeParser` 开关,不接受扩展)。fork-only 新文件放在这两个包里同样触黑名单(路径规则是**整包**级)。
**先例**:`f5b22a840d` / `f7b79f5b94` / `2c2102295d` 三笔均以同一理由 override 过 `ui/marked.tsx`。

**② 风险评估**
- 上游冲突面:上游文件各 +4 行(1 行 import + 3 行注释/参数),带 FORK marker,merge 时是"上游新增 vs fork 加一行"的机械冲突,`UPSTREAM-MERGE-GUIDE §4.3` 三原则可解。
- 功能风险:低。`~~` 路径产出与修前位元一致(测试断言);仅影响单 `~` 的宽松扩展(非 GFM 标准)。
- 漂移风险:两份副本 → 已由守卫测试(比对正则字面量 + 行为一致)机器化。

**③ 逐文件论证**
| 文件 | 为什么必须动 |
|---|---|
| `ui/src/context/marked.tsx` | 唯一产 HTML 的 parser 实例构造点,扩展只能在此注册 |
| `web/.../content-markdown.tsx` | share 页独立 bundle 独立实例,ui 改动不传导 |
| `ui/src/context/marked-del-strict.ts`(新) | 逻辑尽量放新文件(R1 三级跳),上游只留 1 行注入 |
| `web/.../marked-del-strict.ts`(新) | 同上;不建跨包依赖(web 不依赖 ui) |
| `ui/src/context/marked-del-strict.test.ts`(新) | R5 要求;ui 有 test 脚本与 turbo task,web 没有 |

**commit message 将标**:`[override-blacklist: marked tokenizer 覆盖必须 .use() 注册到各自 parser 实例,ui/web 两包无外部注入点,无 wrapper 替代]`
