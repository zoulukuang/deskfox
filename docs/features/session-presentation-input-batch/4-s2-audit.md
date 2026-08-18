feat-id: session-presentation-input-batch
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# S2 · 同批丢失/撤销/失效定制清单(REQ-108 的排查产出)

> 两轮:第一轮 2026-08-15 六维机械排查(结论从 OPENCODE-PLAN 计划搬入定稿);
> 第二轮 2026-08-17 施工中实地发现。**基准 = commit `e77443750e`**(= tag `ship-prod-2026.9.1`,
> 上游同步前最后 fork 状态;计划里写的 `deskfox-baseline` tag 实际不存在,见 1-spec §7)。

## 失效模式四分类(本批总结)

| 模式 | 特征 | 现有手段能不能抓到 |
|---|---|---|
| A **丢失** | 代码整块没了 | grep / marker 聚合比对能抓 |
| B **主动撤销** | 有决策记录,但报备闭环没走完 | 只能靠读 sync plan 的撤销清单 |
| C **判定失效** | 代码在、类型对、marker 全,读的是上游已废弃的数据源 | typecheck 绿 / 单测绿 / review 看着正常 —— **只有真跑才暴露** |
| D **条件关掉** | 被加了门控,但配套提示照旧 | 同 C,且更阴:提示还在教用户去点 |
| E **调用点被冲掉** | 函数与单测都在,就是没人调 | 单测直接调函数所以**照常绿**;导出符号扫描也看不出(import 还在) |

## 清单

| # | 项 | 基准位置 | 当前状态 | 失效模式 | 可感知 | 处置 |
|---|---|---|---|---|---|---|
| 1 | 会话进度条(REQ-108) | `index.css:315` + `message-timeline.tsx:1400`/`:336` + settings 三处 | 四块全无 | **A** | ✅ 高(user 首报) | 本批补回(S1) |
| 2 | shell 折叠(REQ-109) | `message-part-grouping.ts` CONTEXT_GROUP_TOOLS 含 bash | 已撤销,注释留档 | **B** | ✅ 高(user 报刷屏) | 本批以可配置形式回归(S3) |
| 3 | 会话列表运行中图标(REQ-110) | `sidebar-items.tsx` isWorking 读 child store | 代码在,判定恒 false | **C** | ✅ 高(user 报图标没了) | 本批换全局 store(S4) |
| 4 | 权限过滤层候选源(REQ-112) | `permission.tsx:442` 读 child store `permission` | 同上,过滤层 fail-open | **C** | ⚠️ 中(幻影徽标,点了 404) | 本批换全局 store + directory 过滤(S6) |
| 5 | 文件预览器点击收起(REQ-111) | `session-side-panel.tsx` isViewerOpen | 被加 `!newLayoutDesigns()`,v2 失效而 tooltip 照弹 | **D** | ✅ 高(user 报) | 本批新增 tab 入口 + tooltip 对齐(S5) |
| 6 | 收起动画方向(REQ-111) | baseline `:283-294` flex-grow 反向驱动 | 回退成显式 width | **A(局部)** | ✅ 中(手感) | 本批恢复(S5) |
| 7 | **防卡死 reconcile 调用点** | baseline `bootstrap.ts:249-250` | 函数+单测都在,`bootstrap.ts` 只剩悬空 import,**无人调用** | **E** | ⚠️ 中(硬杀/重连后图标残留) | **本批补回**(第 3 批);上游已接管第 ① 半,只补回无等价物的第 ② 半 |
| 8 | `deriveSessionWorking` 单测 | 文件头写明「进 Logic 清单可单测」 | **零测试** | — | ❌ 不可感知 | 本批补 8 条(第 3 批) |

**第二轮新增 = 第 7、8 两条**(施工 REQ-110 时实地撞见)。第 7 条把「失效模式」从四类扩到五类。

## 第一轮已排除的 5 个维度(负面结论也是资产,下次 sync 可直接跳过)

1. **原生菜单 i18n 簇** —— 6 文件 marker 集体消失,查证为主动上游化 + `menu-role-label.ts` 回植,闭环完整。
2. **fork 独有源文件的导出符号** —— 106 个文件逐个查消费方,零孤儿。
   ⚠️ **本轮暴露该方法的盲区**:第 7 条那种「import 还在、调用点没了」的形状,导出符号扫描判为"有消费方"。
3. **`!newLayoutDesigns()` 门控点** —— 45 处逐条看,除 REQ-111 外全是纯样式或上游自身 v2 行为。
4. **设置开关 ↔ 运行时消费方** —— 16 个字段全部配对。
5. **typecheck** —— 33/33 通过。

## 顺带发现(非本次 sync 回归,不进本批)

- **23 个死 i18n key**:`fileTree.dialog.*` 20 个 + `settings.feishu.*` 3 个;PRE 同样零引用 ⇒ sync 前就死了,属历史清理项。
- **4 个 i18n 文件 CRLF 污染**(`da`/`de`/`no`/`tr`):账面 `+5732/-4960`,`git diff -w` 实为 `+197/-4`。建议加 `.gitattributes` 归一化。
- **`submit.test.ts` 加载即挂**:`Export named 'toaster' not found`,clean tree 同样失败(与本批无关,`packages/ui` 侧)。该文件当前**零覆盖**,建议单开一条修。

## 给下次上游同步的闸(方法学结论)

第一轮 marker 聚合比对已把 A/B 两类扫尽,两轮收获全部落在 **C/D/E 族(语义漂移 + 接线丢失)**。

- ✅ **已建**:`packages/app/scripts/check-child-store-reads.sh` —— 扫「绕过全局重定向直读 child store 会话字段」,
  实时解析 `directory-sync.ts` 的 `sessionFields` 作唯一事实源,fail-closed。本批 S4/S6 改完跑闸**零命中**。
- 🔲 **建议新增(本轮教训,未实施)**:**fork-only 导出符号的「真调用点」扫描** —— 现有扫描把 `import` 当消费方,
  漏掉第 7 条那种形状。判据应是「除 import 与自身测试外,是否存在调用」。
- 🔲 **建议新增**:Logic 清单文件的**有测试**校验 —— 第 8 条那种「声明进清单却零测试」现在没人管。

## 报备闭环(可感知项,待当面向 user 过)

2026-08-11 的撤销记录自己标了「⚠️ 可感知变化待报 user」却没落地,导致 user 是自己撞上的。
本批**所有可感知变化**集中列在 `3-changelog.md` 的「待 user 拍板/知会」段,合 main 前当面过一遍。
