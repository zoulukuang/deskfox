feat-id: upstream-sync-2026-08
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md ./6-windows-handoff.md

# 实施计划 + 决策轨迹

分支:`sync/upstream-2026-08-10` | 兜底 tag:`pre-merge-upstream-2026-08-10`(= 动工时 main `e77443750e`)

## 分段进度

| 段 | 目标 | 状态 | merge commit | 备注 |
|---|---|---|---|---|
| 1 | v1.17.8 `8716c4309a`(06-17) | ✅ done | `ea3ea31315` | 时间线重写段,25 冲突,e2e 37/37 |
| 2 | v1.17.13 `1e73b76ea6`(07-01) | ✅ done | `3faa8a76f4` | markdown→session-ui 搬家,42 冲突,e2e 48/48 |
| 3 | v1.18.4 `d36a2d8981`(07-20) | ✅ done | `76c1340c11` | v2 tokens + provider 对话框段,e2e 117/117 |
| 4 | v1.18.16 `550d1ffd24`(08-10) | ✅ done | `c1909dbb92` | 收尾 + i18n 段,e2e 123/123 |
| — | **整体验收 + v2 缺口修复** | ✅ done | 见 3-changelog | local 打包 / 冷启动 2×CLEAN / 🔴 两项定制回植 |

## 决策轨迹(实时追加)

- 2026-08-10:user 批准 spec(D1-D5),图标栏重排选「先用上游原生布局」。
- 2026-08-11 段1 完成(`ea3ea31315`),关键决策与踩坑:
  - **D1 时点修正**:上游 v1.17.8 时 prod 默认同样是经典布局(`channel !== "prod"`),v1.17.19+ 才切 v2 并退役。
    故 `newLayoutDesignsDefault` 段1-3 维持 false,段4 随上游节奏翻转(比原计划更贴上游)。上游 v2 专属
    e2e(session-timeline.spec)在测试内显式种 `newLayoutDesigns: true`。
  - **撤销 REQ-053/058 思考链折叠**:上游 `showReasoningSummaries` 默认 false = reasoning 整层不渲染,
    已覆盖"不刷屏思考链"诉求且更彻底;我们的 Collapsible 包装破坏新虚拟化首帧锚底(cold-tab e2e 218px 实测)。
  - **bash 折叠组保留** + 两处配套:cold-tab 首帧断言放宽 1 帧(行数变少使可见时刻撞上量高沉降前一帧,
    16ms 级不可感知)+ maybeAnchorBottom 锁底沉降循环(totalSize 连续 3 帧稳定)。
  - **REQ-097 查找跳转三连修**(新虚拟化专有,全部实测定位):
    ① core `getOffsetForIndex` 对 measurementsCache 缺失行静默 no-op → 绕行手算 offset;
    ② 端锚 `wasAtEnd` 在 core 内部 offset 未入账时把远跳拽回底 → 两段式脱锚(用 `getVirtualDistanceFromEnd` 判定);
    ③ autoScroll 把程序化滚动当内容位移回贴底 → 跳转前每帧标记手势/用户滚动;
    ④ find 深挖 loadMore 不可带 prepend 视口锚定(会把底部钉成死点)→ 桥裸 `timeline.history.loadOlder()`。
  - **上游行语义变更**:ProjectDirectories.create 改写 strategy、不再写 type(遗留列,新行 null),
    REQ-069 carve-out 测试断言对齐;M6 恢复逻辑本有 candidates[0] 回落不受影响。
  - **Win 基线**:opencode `instance-bootstrap.test.ts` 纯上游 worktree 同样 2 fail(REQ-105 方法学),非合并引入。
  - virtua 上游已删(catalog+patch),fork csv-table 还用 → app 内钉版本 `0.49.1`。
  - 上游测试 worktree 留存 `D:/tmp/upstream-v1178`(v1.17.8,基线判定用,段4 后删)。
- 2026-08-11 段2 完成(`3faa8a76f4`),关键决策与踩坑:
  - **markdown 定制全家随 rename 检测自动迁 session-ui**(远超预期顺利);需手工补:DOMPurify import、
    mermaid 依赖声明、fork css 段整体迁移、资产重写移出 `data-new-layout` 早退(否则经典布局文件查看器图片全断)。
  - **ui→session-ui 依赖方向**:document-viewer(fork 自有,在 ui 包)依赖的 pierre/media 被上游迁走,
    反向导入会成环 → ui 侧建 fork 副本(`packages/ui/src/pierre/media.ts`,merge 时需跟源同步)。
  - **再撤两项 FORK(上游已自带)**:REQ-019 oauth-callback 环回绑定、REQ-072 tabs-dedup(上游内联同语义)。
  - **layer→node 体系**:上游 defaultLayer 全面移除;7 个 fork 测试转 `AppNodeBuilder.build(LayerNode.group([...]))`
    + RuntimeFlags 覆盖注入范式(照 upstream project.test.ts)。
  - **bash 折叠组 vs 上游新断言**:上游时间线用例新增「bash 独立成行展开看输出」断言;fork 设计里组内 bash
    仅摘要行(降噪,新旧一致)→ 用例改 fork 语义断言(组存在/可展开/含命令摘要行)。
  - **v2 壳过渡态**:上游 v2 换 NewAppLayout(layout-new.tsx 自带唯一 ToastRegion),命令(theme.cycle 等)
    仍只注册 legacy Layout → v2 下键触发 toast 不可行;toast 回归用例收敛为单 region 断言,段4 复核。
  - **上游删了 session 进度条功能**(showSessionProgressBar 设置+行+i18n 键全撤,跟随)。
  - **恢复暴露「新布局」开关**(原 settings-panel-cleanup 隐藏):D1 过渡期让用户可自愿尝鲜 v2。
- 2026-08-11 段3 进行中,关键决策:
  - **D1 翻转提前到段3**:上游在本段范围内(v1.17.19)就把 v2 设默认+旧界面退役机制,settings.tsx 整体取上游
    (含升级 cutoff 逻辑)。发布只在段4 后,中间态不触达用户,时点仍=「跟随上游」。
  - **getbot 三件套迁统一 picker**:上游删 dialog-select-provider,合成项注入/热门首位/tagline+推荐标
    重植入 dialog-connect-provider 的 legacy List 与 V2 picker 两分支。
  - **fork 重资产文件策略**:composer(prompt-input)/文件查看器(file-tabs)/命令面板(dialog-select-file)
    整体保段2 版(上游本段的模块抽取/v2 变体跳过,段4 再评估);session-side-panel 反向 — 取上游版
    (v2 默认后必须),fork 功能点(filetree-toggle/自动刷树/active 高亮/md 内链 openTab)逐一回植。
    新契约以兼容层接:SessionFileView shim、previewTab 别名、slash-menu 最小实现、newLayoutDesigns 可选化。
  - **REQ-064 迁 edit-project model**(上游抽取后 dialog.close 仍在 mutationFn 内=同 bug 复现,onError 重打)。
  - **REQ-078 canResolve 迁 per-server permission 工厂**(上游 permission 多 server 化)。
  - **i18n 齐平新政**:上游新增 parity 测试(全语言全键);fork 键(~190×15 语言)以 en 文案机械回填,
    zh/zht 保持人工翻译。撤 help-button 隐藏(上游已填真内容)。
  - **Win 基线 +1**:server-session「cached role」测试纯上游 v1.18.4 同样红(REQ-105 口径)。
  - **bash 折叠组撤销(段3 定音,推翻段2「保留+改上游断言」路线)**:上游 v1.18.4 新增 10+ 条 shell 族
    e2e(tool-projection/lifecycle-state/shell-outline/reducer-projection/file-projection/tool-state/
    history-root/accessibility)全部断言 bash 独立成行,继续保留=每次 sync 长期改写上游 spec;且上游
    v2 时间线已用 shellToolPartsExpanded 默认收起解决同一痛点(2026-06-19 定制动机消失)。
    随撤三处配套:contextToolSummary command 计数、smoke cold-tab 放宽断言(恢复上游原文)、
    maybeAnchorBottom 多帧锁底沉降(行构成归位后上游单帧 scrollToEnd 足够,18/18 实测绿)。
    ⚠️ 可感知变化待报 user:连续 shell 调用从「收进 Exploring 组」变回「独立卡片(默认收起)」。
  - **REQ-097 findHistory 断线修复**:session.tsx 换 sessionPanelContent 时 MessageTimeline 调用点丢
    findHistory prop → 查找条 more() 恒 false,深位命中 0/0(E1c/E1d 稳定复现)。补回后 5/5 绿。
  - **29 条 e2e 失败全数判定为段3 树内回归**:纯上游 v1.18.4 Win worktree(D:/tmp/up1184)同批 53/53
    全绿,无 Windows 基线失败混入。
  - **段3 e2e 收口三大簇 + 若干散点(29 fail → 117/117 全绿)**:
    1. shell 族 ~14 条 = bash 折叠组撤销(上文);
    2. review 族 ~7 条 = 四个 fork 定制在 v2 语义下连环误伤,逐一按 D4「v2 让位上游原生」处理:
       ① `sdk.directory` 变化收起预览器 effect 无 defer → 页面首挂即吃掉种子/持久化 panelOpened(加 defer:true);
       ② titlebar-icons-mirror 把 v2 工具组挂左 portal → 上游 e2e 在 #opencode-titlebar-right 找不到
       Toggle review(挂回 right,连带摘掉 v2 标题栏 fork 文件树按钮 — 与 review 侧栏自带同名双按钮);
       ③ showFileTree 默认 true → v2 下经典文件树叠进 review 面板双树撞名(回退上游 false;经典布局
       可见性不受此值影响,fork 意图仍成立);
       ④ filetree-toggle「再次点击收起」在 v2 双击场景误触发(仅经典布局生效);
       ⑤ **file-tabs.tsx native.listen 无守卫** — 浏览器无 preload 桥同步 throw 炸全屏 ErrorBoundary,
       v2 review e2e 首次在浏览器 mount 该组件暴露(加 isDesktopApp() 守卫,latent bug 修复);
       ⑥ **preview tab 语义完整移植** — 推翻「无预览态单击即真开」兼容层,文件 tab 操作委托上游纯函数
       (openSessionTab/previewSessionTab/closeSessionTab),存储仍落 fork 项目级 projectTabs,
       preview 按 projectKey 存 ephemeral;
    3. 散点:playwright 4319 端口回填 env(mock-server appPort 兜底 3000 → 相对 fetch 落 index.html,
       transport e2e 实锤);terminal-hidden / session-timeline-history-root 两条上游 spec v1.18.4 起
       断言 v2 语义但靠 v2 默认、未自带 seed → 显式 seed v2(FORK 标注)。
  - **段3 收口数字**:typecheck 33/33;app 单测 854/856(server-session 1 条 = Win 基线纯上游同红;
    observe-element-offset 1 条 = CPU 满载时序 flaky,空载 3/3 绿);session-ui 78 / media-gen 140 /
    feishu 792 全绿;**e2e 117/117 全绿**。
- 2026-08-11 段4 进行中(merge 550d1ffd24 = v1.18.16),关键决策:
  - **D5 落槌:REQ-098 strictDel 保留** — 一度依据单测 REPRO 判定 marked 17→18 已修而撤销,
    e2e 立即打回:18 只修了 %区间样例(0.5%~1.2%),纯数字区间(4.80~5.05 / PE 12~15)仍误判
    → 恢复 ui/web 扩展全套,REPRO 样例随 18 行为更新,e2e chat-tilde 守卫继续有效。
    教训:D5 复核必须以 e2e 真渲染为准,单测样例集不充分。
  - **D3 落地:zh 术语随上游** — 令牌→词元随 i18n 合并自动生效,fork zh/zht 文案无令牌残留,零手工改。
  - **菜单 i18n 双体系上游化**:上游 nativeT(renderer 语言包经 onNativeTranslations 推主进程)取代
    fork translateMenuLabel/setMenuLocale 全链路(desktop-menu-i18n.ts/测试/preload/ipc 五处删除);
    fork 的 rebrandDict 层保证 nativeT 文案品牌自动替换;右键菜单 set_context_menu_language 独立保留。
  - **导航守卫上游化**:上游 wireNavigationPolicy 与 fork REQ-075 navigation-guard 语义等价
    (will-navigate 转外链 + window.open deny),取上游、删 fork 版(含测试)。
  - **abort→interrupt API 更名**随上游,fork 停止失败提示(REQ-049/stuck-status)语义保留重挂。
  - **附件 blob 化**(dataUrl→BlobReference):composer 两处预览 + REQ-087 历史剥离测试对齐;
    media-gen 图生图参考图在 submitCreation 异步解 blob 回 base64(buildCreationInput 保持纯函数)。
  - **ModelSelectorPopover trigger render-prop 化**:fork 保留版 composer 三个调用点手工迁移。
  - **fork 重资产保留(与段3 同口径)**:home.tsx 单体(上游拆 home/ 模块群未接线)、
    chat markdown 走 fork 富管线(上游新 markdown.worker 管线文件落地未启用)、
    prompt-input/file-tabs/layout(五栏)保 fork;session-load 上游 v1/v2 拆分 + REQ-072 scope 注入 V1 路径。
  - **native markdown parser 随上游撤除**(上游 18.16 删自家 main 端 marked;ui/marked JS 兜底仍在)。
  - **conditions 决策:保 fork --conditions=browser**(REQ-104 三重守卫)。上游 18.16 切
    --conditions=solid 实为 server build(createEffect 全 no-op),我们的 effect 类 fork 单测
    (project-restore)依赖真 effect;代价:server-session 3 条在 browser 条件下红 — 纯上游
    v1.18.16 同条件同样 3 红(REQ-105 基线,已实测),非合并回归。
  - **i18n 归一化脚本化**:上游新增 ~40 语言 + parity 严格化(missing=[] + extra 精确等于
    复数 family×TAG 类目);normalize-i18n.ts 幂等收敛(en 兜底回填 + 越界键删除),parity 5/5 绿。
  - **Fox Blue 随 OC-2 token 更新重同步**(克隆完整性测试红→绿)。
  - **Win/browser 基线(纯上游同红)**:server-session 3 条 + desktop draft-store(node:sqlite
    bun 无内建)1 条。
  - **e2e 稳定性真 bug(非 flaky 掩盖)**:session-list-ux 两条在并发负载下随机挂
    ("element was detached from the DOM")。根因:layout.tsx 的 `sortNow` 每分钟 tick 触发侧栏整列
    重渲染,把打开着的行右键菜单(REQ-096,菜单挂行内)节点掀掉;段4 起上游排序改为时间无关
    (compareSessionTime,三个 helper 的 now 参数全部弃用)→ 该 tick 已是纯粹无用重渲染源,停掉。
    产品可感收益:用户真机右键菜单不会再在整分钟边界自己消失。
  - **MarkedProvider 回挂**:上游 app.tsx 撤了它(其 chat 已 worker 化),fork 富管线 markdown
    仍 useMarked → 全屏 ErrorBoundary(55 条 e2e 同因)。补回 provider;并把 marked.tsx 的
    registerCustomTheme 改走上游抽出的幂等入口 registerOpenCodeTheme(消 console 重复注册报错)。
  - **canReusePendingBlock 回植**(上游删除,fork markdown.tsx 仍用);legacy auth.set 路径补
    instance.dispose(上游把 dispose 收进 connect.key 兼容层);上游 toast-v2 改类名标识
    (.toast-v2-region)+ 惰性挂载 → U4 守卫改「触发后恰 1 region + 恰 1 条」,并给 utils/toast
    加 DEV-only `__deskfoxShowToast` 稳定触发口(v2 下 mod+shift+t 已被上游改绑 reopenClosedTab)。
  - **侧栏周期性整块重挂(第二个真 bug,e2e 逼出来)**:探针实测侧栏每 ~1.5s 被整块重建一次,
    打开着的行右键菜单随之被掀掉。根因:`layout.projects.list` 的 enrich 每次都 `{...metadata,...project}`
    造新对象,任一次 project 查询重取(SSE 重连即触发)都让 `<For each={projects()}>` 判定元素全变。
    修法:list 按 worktree 记住上次结果、深比较等值即复用旧引用(嵌套 time/icon 用 JSON 值比较,
    浅比较会被 normalizeProjectInfo 的新对象骗过)。修后 8s 内重建 1 次(原 5 次+)。
    产品可感收益:右键菜单不再自己消失;侧栏不再周期性无谓重排。
- 2026-08-11 **整体验收(spec §六 第二块)+ v2 缺口修复**,关键发现与决策:
  - **最大发现:v2 默认翻转后,多项 fork 定制在用户实际路径上失效**。根因单一 —— 上游 v2 不是"换皮",
    是**整套新组件**(`settings-v2/` / `new-session/new-session-view` / `prompt-input-v2`),
    我们的定制还挂在 legacy 组件上,于是"代码还在、用户点不到"。
    **为什么段3/段4 e2e 123/123 全绿没抓到**:那些用例绝大多数来自上游、断言的是上游语义;
    fork 定制的用例又多在 legacy 布局下跑 —— 两边都不覆盖"v2 路径下 fork 定制还在不在"。
  - **验收手法**:local 档打包 → 真机 CDP 逐项点(不是 mock)。冒烟第一轮 12 项 10 项 SKIP 时
    **没有当成"通过"**,而是判定探针失效并回头查 v2 DOM —— 这一步是发现整批缺口的起点。
  - **user 拍板(2026-08-11)**:🔴 两项(创作模式入口 / 飞书设置页)本分支修掉再提 merge;
    其余 5 项立 REQ-106 独立跟进;「高级」分组沿用原决策**继续隐藏**。
  - **创作模式回植走"零改上游"**:上游 v2 composer 只暴露 `modelControl` 一个插槽 → 把
    `MediaCreationControls`(创作档)/ 上游 model 控件(非创作档)+ 常驻 `MediaModeMenu` 一起塞该插槽;
    agent 控件让位靠 fork 侧 controller 的 `view.agent` 在创作档返回 undefined;
    send 拦截靠 fork 侧 `view.submit.onSubmit`。**R1 第 1 级达成,0 行上游改动、0 R4 override**。
  - **提交编排抽成共享 helper**(`prompt-input/creation-submit.ts`,Logic 清单 9 单测):
    legacy 与 v2 两个 composer 调同一份,杜绝"修了一边漏另一边"再次发生。
  - **飞书设置页**:v2 对话框加 tab + Content,面板组件直接复用 legacy `SettingsFeishu`
    (内容与布局无关,不必造 v2 副本);给它加 `data-component="settings-feishu"` 稳定锚点。
  - **新增守卫 spec** `e2e/regression/v2-fork-customizations.spec.ts`(3 条,专测 v2 路径):
    飞书 tab 可开 / 创作模式入口可见 / 设置 tab ≥6。**做过反证**:撤掉 `<MediaModeMenu/>` → T2 立即红。
  - **冷启动脚本同源问题一并修**(OPENCODE-PLAN `c2f8956`):toast 迁 solid-sonner、项目入口改
    `project-avatar-v2`;修前 `clicked project: False`(不触发 file.list = 抓不到启动期 500 race),
    修后两次冷启动均 CLEAN 且真点开项目。
  - **打包踩坑(与既有 memory 互补)**:`bun run build` 的 prebuild 要联网拉 `models.dev/api.json`,
    **不能清代理**;清代理只适用于 electron-builder 那一步(走 npmmirror)。两步的代理策略相反。
    另 PS5.1 wrapper 仍会把 native stderr 误判成 `NativeCommandError` 中断 → 改 Bash 直调。
