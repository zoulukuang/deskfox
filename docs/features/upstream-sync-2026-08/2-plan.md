feat-id: upstream-sync-2026-08
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

分支:`sync/upstream-2026-08-10` | 兜底 tag:`pre-merge-upstream-2026-08-10`(= 动工时 main `e77443750e`)

## 分段进度

| 段 | 目标 | 状态 | merge commit | 备注 |
|---|---|---|---|---|
| 1 | v1.17.8 `8716c4309a`(06-17) | ✅ done | `ea3ea31315` | 时间线重写段,25 冲突,e2e 37/37 |
| 2 | v1.17.13 `1e73b76ea6`(07-01) | ✅ done | `3faa8a76f4` | markdown→session-ui 搬家,42 冲突,e2e 48/48 |
| 3 | v1.18.4 `d36a2d8981`(07-20) | pending | - | v2 tokens + provider 对话框段 |
| 4 | v1.18.16 `550d1ffd24`(08-10) | pending | - | 收尾 + i18n 段 |

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
