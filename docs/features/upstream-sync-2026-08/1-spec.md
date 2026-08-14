feat-id: upstream-sync-2026-08
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md ./6-windows-handoff.md

# 上游同步 2026-08 — be227503af (v1.17.4) → 550d1ffd24 (v1.18.16)

> 规模:**Large**(1281 上游 commits / 99 冲突文件 / 76 个带 FORK 定制)。
> 按规范本 spec 需 user 审签后动工。
> 工作分支:`sync/upstream-2026-08-10`(已建,基于 2026-08-10 最新 main)。

## 一、背景与漂移数据

| 项目 | 数值 |
|---|---|
| 上次同步基点 | `be227503af`(2026-06-12,上游 v1.17.4) |
| 上游领先 | 1281 commits(fix 493 / chore 320 / feat 214 / refactor 75) |
| 目标点 | `550d1ffd24`(2026-08-10,上游 v1.18.16) |
| merge-tree 预演真实冲突 | **99 文件**(94 content + 4 modify/delete + 1 add/add) |
| 冲突中带 FORK 定制 | 76 文件 |
| 上游新增包 | session-ui / protocol / client / codemode / schema / sdk-next / httpapi-codegen |

漂移 1281 已远超健康基线(≤100),不合会越来越贵。

## 二、上游主线:v2 架构换代(不是攒功能)

1. **v2 UI 已成默认且旧界面在退役**:`settings.tsx` 里 `newLayoutDesignsDefault = true`,自 v1.17.19 起有 `oldInterfaceRetired` 升级切换逻辑。全部组件迁 v2 design tokens,设置页 / 模型选择 / review 面板 / 各弹窗逐个重画。
2. **会话渲染整体搬家**:`packages/ui/markdown.*` 删除 → 重写进新包 `packages/session-ui/`,markdown 改 **worker 线程流式渲染**(带完整测试)。
3. **会话时间线重写**:`message-timeline.tsx` 删除重写,官方称"much faster, no flicker or scroll jumps"。
4. **Provider 连接对话框统一**:`dialog-select-provider.tsx` 删除,合并进统一对话框。
5. **后端 core 大重构**:layer exports 移除、事件模型简化、测试 node 化、session context epochs 简化 —— 编译不报错但可能静默改行为。
6. **MCP 升级**:客户端 SDK v2、资源读取工具、`mcp__server__tool` 命名规范、server instructions 注入。
7. **实用新功能**:会话快照/回滚、会话导出 JSON、拖拽标签页、中键开标签、mod+n 新标签、右键项目菜单、Cmd+K 列会话、终端主题同步、全球 locale 覆盖 + RTL。

## 三、方案:按上游 release 节点分 4 段 merge

**否决的备选**:
- 一次性 merge:99 冲突里 76 个带定制,一次解完无法归因、无法单独回退。
- 只 cherry-pick 功能:漂移继续扩大,v2 换代绕不过去,下次成本更高。

**采用:分段 merge**,每段以上游 release tag 为切点(上游发版点=相对稳定态),每段独立解冲突 → 跑测试 → 独立 merge commit,可单独定位/回退:

| 段 | 切点(上游版本) | 日期 | 主要内容 | 硬骨头 |
|---|---|---|---|---|
| 1 | → v1.17.8 `8716c4309a` | 06-17 | 会话时间线重写落地 | message-timeline 定制重移植(REQ-097 会话内查找 / 创作结果卡 / REQ-096 标题失焦保存) |
| 2 | → v1.17.13 `1e73b76ea6` | 07-01 | ui 会话组件隔离(markdown → session-ui) | markdown 全家 8 项定制重落位(mermaid / callout / 脚注 / 锚点 / 本地资源重写 / **REQ-098 波浪号**) |
| 3 | → v1.18.4 `d36a2d8981` | 07-20 | v2 tokens 大迁移 + provider 对话框统一 | getbot 置顶/tagline/推荐标迁新对话框;Fox Blue 主题锚点实测 |
| 4 | → v1.18.16 `550d1ffd24` | 08-10 | 收尾 fix + i18n + stats | zh 术语对齐决策(见 §五-7) |

每段收口标准(R9):typecheck 全绿 + fork 包单测全绿 + Phase 1 mock e2e 绿 + 该段硬骨头的定制功能 CDP 实测通过,才进下一段。
四段全过后:local 档打包 → smoke.py 全量冒烟 → 冷启动健康检查 ≥2 次 CLEAN → 真桌面 QA 清单(§六)→ **向 user 提请合 main**(三铁律,不自动合)。

## 四、定制重移植清单(硬骨头明细)

上游删了我们改过的 4 个文件,定制必须在新架构重新落位:

| 我们的定制 | 原位置 | 新落点 | 说明 |
|---|---|---|---|
| REQ-097 会话内查找 | message-timeline.tsx | 上游新时间线 | 可定位单元/reveal 逻辑要适配新虚拟化结构 |
| 创作结果卡融入聊天流 | message-timeline.tsx | 上游新时间线 | media-gen 核心 UX |
| REQ-096 标题失焦保存 | message-timeline.tsx | 上游新时间线 | 小 |
| Mermaid 渲染 | ui/markdown.tsx | session-ui worker 管线 | 占位→SVG 两段式,要适配 worker |
| GitHub callout / 脚注 / emoji / 中文锚点 | ui/marked.tsx | session-ui | tokenizer 定制群 |
| 本地资源 src 重写 / 相对链接不开外部浏览器 | ui/markdown.tsx | session-ui | 文件查看器依赖 |
| **REQ-098 单波浪号误删除线** | ui/marked.tsx | session-ui | ⚠ 先验证上游新管线是否自带此 bug,有则重打,没有则关闭防漂移守卫 |
| getbot 置顶 / tagline / 推荐标 | dialog-select-provider.tsx | 上游统一 provider 对话框 | 盈利核心,必须保 |

其余 72 个 content 冲突里的定制(desktop 品牌/IPC/OOM 刹车、oauth-loopback、飞书 UI、设置清理、iconbar 重排、i18n 品牌文案等)为常规三方解,FORK marker 齐全可逐个核对。

## 五、⚠ 用户可感知的变化(需 user 知情/拍板)

1. **整体界面观感换代(最大)**:合并后进入上游 v2 界面 —— 设置页、模型选择器、各弹窗、review 面板、首页全部新样式。**建议:跟随上游**。理由:旧界面上游正在退役,守旧=永久分叉+维护成本爆炸;v2 是上游两个月打磨的方向。
2. **会话时间线体验变好**:更快、不闪烁、滚动不跳。纯增益,采纳。
3. **提示框(toast)样式变化**:上游迁 solid-sonner。小变化,跟随。
4. **新增操作习惯(纯增益)**:标签可拖拽 / 中键开新标签 / mod+n / 右键项目菜单 / Cmd+K 列会话 / 会话导出 JSON / 会话快照回滚。
5. **我们的「图标栏重排」(iconbar-left-decouple)**:v2 布局变了,原重排大概率要重做或失效。**决策点:在 v2 下重做,还是先接受 v2 原生布局、用一段时间再评估?**(建议后者 —— 先别在新布局上急着做定制)
6. **Fox Blue 主题**:走 fork CSS scope 理论上存活,但 v2 tokens 变量名变了,需 CDP 实测,可能要按《fork-主题制作指南》修锚点。
7. **中文术语**:上游把 token 译名「令牌」改成「词元」并统一开发者术语。**建议跟随**(和上游 zh 文案对齐减少每次 merge 的 i18n 冲突),品牌文案(DeskFox 自有文案)保留不动。
8. **飞书 / 创作模式 / 文件预览不应有感知变化**:这些是 fork 自有包,但它们挂靠的 server API / 时间线 / prompt-input 都被上游动过,列入回归重点(§六)。

## 六、测试用例清单(R8,动工前锁定)

**每段收口**(4 段各跑):
- [ ] `bun run typecheck` 全绿(fork 范围)
- [ ] fork 包单测:media-gen / adapter-feishu-lark / app 全绿
- [ ] Phase 1 mock e2e(聊天主循环)绿
- [ ] 该段硬骨头定制 CDP 实测(§四对应行)

**四段全过后的整体验收**:
- [ ] local 档打包成功,exe 文件名/徽标/appId 正确(渠道 env 两步都喂)
- [ ] `smoke.py` 全量冒烟:供应商连接 / 面板 / 设置 / 文件预览无渲染崩溃
- [ ] 冷启动健康检查 ≥2 次 CLEAN
- [ ] markdown 回归:mermaid 图 / callout / 脚注 / 中文锚点跳转 / `4.80~5.05 … 5.20~5.35` 不划删除线
- [ ] 会话内查找(REQ-097):跨深位命中可遍历
- [ ] 创作模式:出图 → 结果卡入聊天流 → creations/ 落盘
- [ ] 文件预览:pdf / docx / xlsx / 图片(干净项目流程)
- [ ] 飞书:绑定状态显示 + 收发一轮
- [ ] getbot:provider 弹窗置顶 + 推荐标 + tagline
- [ ] Fox Blue 主题切换实测取色
- [ ] 托盘健康状态 / OOM 软刹车日志(REQ-049)存活
- [ ] 真桌面 QA:托盘 / 通知 / 窗口标题品牌 / 深链(CDP 测不了的)

**回归基线**:所有既有测试(含防漂移守卫,若 REQ-098 上游已修则同步撤守卫)。

## 七、风险与回退

- **每段一个 merge commit**,段内出问题 revert 该段即可;整个 sync 分支不合 main 前对 main 零影响。
- 动工前打 tag `pre-merge-upstream-2026-08-10` 兜底。
- **后端静默行为变化**(core 重构/事件模型)是最大隐性风险 —— 靠冷启动健康检查 + 飞书/创作模式端到端回归兜住。
- in-progress 的 feat 分支(session-heal-stat-timeout 等)合并后要 rebase,冲突自负,本 spec 不含。
- 工作量粗估:**2~4 周**(纯解冲突不大,大头是 76 处定制在 v2 下重验证)。

## 八、需 user 拍板的决策点

| # | 决策 | 建议 | user 拍板 |
|---|---|---|---|
| D1 | 接受 v2 界面换代 | ✅ 接受(旧界面在退役,无长期守旧选项) | ✅ 批准(2026-08-10) |
| D2 | 分 4 段 merge 方案 | ✅ 按本 spec | ✅ 批准(2026-08-10) |
| D3 | 中文术语跟随上游(令牌→词元) | ✅ 跟随,品牌文案除外 | ✅ 批准(2026-08-10) |
| D4 | iconbar 重排在 v2 下暂不重做,先用原生布局 | ✅ 先用一段再评估 | ✅ 先用上游原生布局(2026-08-10) |
| D5 | REQ-098 若上游已修,撤我们的 override + 守卫 | ✅ 撤(减少侵入) | ✅ 随 D1-D3 批准 |
