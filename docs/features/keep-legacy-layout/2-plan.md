feat-id: keep-legacy-layout
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹 — 不跟随上游 v2 换代

## 一、实施顺序(实际发生的四笔)

| 笔 | commit | 内容 |
|---|---|---|
| 1 | `b86d15779b` | 默认翻回经典布局(堵 4 条路径)+ 标题栏图标锚左 |
| 2 | `98a8bbaf9b` | 修双渠道徽标 + 工具组左挂载在 web 端回落;落 `classic-layout-default.spec.ts` |
| 3 | `d837f71536` | 三层机器比对 → 补回 8 处丢失的 fork 交互 |
| 4 | `d7be6c9d3d` | 伪 tab 过滤改按**解码后**路径比对(真机实测发现) |

## 二、决策轨迹

### D-1 推翻上游同步 spec 的 D1(user 2026-08-11)

`upstream-sync-2026-08` spec D1 = "跟随上游 v2 换代",四段 merge 已按此完成。
user 真机试用 v2 后决定不采用 → 本 feat 把**默认**改回经典布局。
**四段 merge 不回退**(上游代码照收,只是界面默认值站回 fork 侧),回退成本因此极低。

### D-2 上游原逻辑"改名保留"而不是删掉

`shouldEnableNewLayout` 被改成恒 `false`,上游原实现原样搬到 `upstreamShouldEnableNewLayout`
并**继续被单测覆盖**。理由:下次 merge 上游若改这段逻辑,冲突能正常解;直接删会让上游改动
无处落地(P3 适配层思路的变体)。

### D-3 4 条路径必须一次堵齐

只堵默认值不堵退役日 → 2026-09-14 到期后自己切回 v2 且忽略用户开关;
只堵新档案不堵渠道默认 → dev/local 档仍是 v2。任何一条漏掉都表现为"过一阵子自己变了",
排查成本极高。故 4 条一次性全堵,并逐条留单测。

### D-4 用"三层机器比对"找丢失的定制,不靠人眼逐屏点

基准 = sync 前 main `e77443750e`。三层:
1. **命令注册表 diff** — 原版 174 个命令 id 新版全在,0 缺失;
2. **FORK marker 按 feat 聚合 diff** — 暴露"标记变少"的定制;
3. 各区域 **i18n 文案 key / 右键菜单项 / 交互 handler** 逐文件比对。

**核心发现(踩坑,值得长期记住)**:上游 merge 冲掉的往往是**调用点而非定义** ——
handler 还在、组件仍支持 prop、菜单项 JSX 还在,只是没人传/没人调 → **静默失效**,
grep 定义找不出来,e2e 也照绿。这就是"代码还在、用户点不到"的第二种形态
(第一种是 sync 发现的"定制留在 legacy 组件、v2 不渲染")。

### D-5 判定为"非缺口"、有意不恢复的 5 处

核实后属于有意撤销 / 重构合并,**不恢复**:
`pdf-render-path`(`file-media.tsx` 被上游删,链路已迁 file-tabs→DocumentViewer)、
`chat-input-focus-follow`(两处注册合并成 `bindEditorRef`,已覆盖两分支)、
`settings-panel-cleanup` 2 处(段2 有意恢复 v2 开关暴露 / 段4 菜单 i18n 上游化)、
composer 项目选择器(上游删 `controls.projects`,fork 跟随)。

### D-6 文件树开关按布局分支,而不是无条件恢复

段3 曾整组摘除标题栏文件树图标,理由是 v2 的文件树开关已在 review 侧栏、标题栏再放一个会与
上游 e2e strict 撞名。**该理由只在 v2 成立** → 改为 `fileTreeVisible: !isV2() && tree()`:
经典布局显示、v2 不显示。两边都不破。

### D-7 镜像布局只翻视觉、不改 DOM 顺序

经典布局把文件树排最左、文件树 tab「所有文件 | N 更改」对调,一律用 `flex-row-reverse` +
边框/手柄换边实现,**DOM 顺序保持上游原样** —— 上游若增删 tab 仍能正常 merge。

### D-8 伪路径过滤必须解码后比对(真机实测推翻第一版实现)

第 3 笔的过滤写成 `tab.includes("<chat selection>")`,单测绿、真机**没生效**:
项目 tab 里存的是 URL 编码形式 `file://%3Cchat%20selection%3E`,原文 includes 匹配不上。
第 4 笔抽出 `isChatSelectionTab()`:先原文比、再 `decodeURIComponent` 比(带 try/catch 兜非法编码)。
⚠️ **这条是"单测绿 ≠ 真机对"的又一例**:存量数据的实际形态只有真机能告诉你。

### D-9 双徽标 bug 的成因

段3 merge 时上游在外层又加了一个 `ChannelIndicator`,与 fork 那处重复 → 经典布局左上出现
两个 LOCAL/DEV 徽标。修法:保留 fork 位置那处(徽标跟终端图标同组),把上游那处的 `debugTools`
prop 并过来后删掉外层。

## 三、开放项

- `oldInterfaceSunset` 类型由 `Date` 放宽成 `Date | null`,上游若把它改成必填需在下次 merge 留意;
- REQ-106(v2 路径下 5 项定制回植)优先级随本 feat 下降 —— v2 不再是默认,不阻断可用性。
