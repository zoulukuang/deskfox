feat-id: upstream-sync-2026-08
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md ./4-verification-checklist.md ./6-windows-handoff.md

# 会话交接说明(新 session 接手必读)

> 🪟 **Windows 端请直接看 [`6-windows-handoff.md`](./6-windows-handoff.md)** ——
> Mac 侧已全量验完,那份只讲 Windows 特有的部分,并列明哪些脚本可直接跑、哪些要重写。
> 本文件是 Mac 侧的历史交接,可略读。

> 2026-08-13 立。上一个 session 过长,任务未完,此文用于让新会话在**不重复踩坑**的前提下接续。
> 读完本文 + 下面点名的三份文件,就具备继续工作的全部上下文。

## 一、任务是什么

把上游 anomalyco/opencode **v1.17.4 → v1.18.16**(1281 笔 commit)合进 fork,
**同时保证 DeskFox 用户的操作习惯与功能一个都不少**。

分支 `sync/upstream-2026-08-10`。**main 一行未动,也从未 push** —— 三铁律要求合 main 与 push 都需 user 逐次点头。

## 二、必读文件(按顺序)

1. **`packages/branding/smoke/CHECKLIST.md`** —— 功能测试总清单(63 项),含清单的**生成方法**与维护规则。测什么看它。
2. **`packages/branding/smoke/UIPROBE.md`** —— 界面交互测试工具包,含**三条硬规矩**与坐标系说明。怎么测才算数看它。
3. **`docs/features/upstream-sync-2026-08/3-changelog.md`** —— 本次同步的完整改动与踩坑记录(§7 是 Mac 端接力部分)。
4. 本文件 §五「不要重蹈的坑」—— 上个 session 的血泪,**务必读**。

## 三、环境现状(接手时可能仍在)

| 东西 | 位置 | 说明 |
|---|---|---|
| 当前版 local 包 | `packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app` | 含本轮全部修复 |
| **基准版 worktree** | `/Volumes/ExtSSD/deskfox-baseline` | git worktree,detached 于 `e77443750e`(合上游前);**user 决定长期保留复用** |
| 基准版 local 包 | 同上路径下 `dist-deskfox/mac-arm64/` | 用于判定「回归 vs 长期问题」 |
| user 的正式版 | `/Applications/DeskFox.app` | **绝不可杀** —— user 长期开着工作,当前会话的 agent 就跑在里面 |

**重建 local 包**(改完代码验证时用):

    cd packages/desktop
    BUN_CONFIG_REGISTRY=https://registry.npmjs.org OPENCODE_CHANNEL=local bun run build
    env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
      ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
      ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" \
      ELECTRON_CACHE="/Volumes/ExtSSD/.cache/electron" OPENCODE_CHANNEL=local \
      node_modules/.bin/electron-builder --mac --dir --publish never --config electron-builder.deskfox.config.ts

三个 env 缺一不可:npmmirror 未同步 sidecar 版本、代理会让 electron checksum 请求挂死、缓存在外置盘。

## 四、进度

**已完成并真机验证的修复**(详见 3-changelog §7 与各 commit):

- locale 检测跨 ICU 版本行为分叉(Aran/Arab script 归一化)
- 存量库升级后应用打不开(上游迁移撞外键 → 启动前清孤儿行,零改上游)
- 经典布局镜像溢出方向(row-reverse → order)+ **源码级守卫**防复发
- 分隔线看不见(真因是被子元素覆盖,改用伪元素绘制)
- 右侧面板盖住查找框关闭键/会话「更多」(侧面板宽度 clamp 只改一半 → 抽唯一事实源)
- 失焦后回车切预览 + 点文件树时焦点真正落入
- 代码类文件选中统一为右键加入聊天(去掉行内评论)
- [窗口] 菜单三个 Electron role 项中文化,且补回被覆盖的两个功能
- 首启默认窗口 1280×800 → 1440×900(上游默认放不下 fork 的五栏布局)
- local 档配置隔离 + 修 plugin-install 长期写错文件的潜伏 bug

**清单执行进度**:

- 第 1 组(桌面外壳)12 项:已验 6 项,发现的差异已修完
- 第 2 组(主界面骨架)10 项:核心 5 项已验;`run_group2.py` 可自动跑 #15/#17/#18/#20/#21
- 第 3~7 组:**基本未验** ← 接手后的主要工作

**第 2 组两个 SKIP 项**(环境前提不满足,非缺陷,补前提即可验):

- #15 文件树 tab 互切 —— 需**先打开一个会话**,否则不渲染 tab
- #21 通知面板 —— 入口 `Notifications (alt+T)` 存在但 `height=0`(折叠态),需先展开

## 五、不要重蹈的坑(上个 session 的血泪)

### 5.1 验证方法(违反必出假绿)

1. **真实输入**,不用 `element.click()` / `new KeyboardEvent()` —— 触发不了 SolidJS handler。
   曾据此得出「侧栏 toggle 失效」的错误结论。
2. **可靠指标**,不用 `innerText.includes()` —— 被同名文案污染。改读 `--main-right` 这类变量本身。
3. **视觉改动像素级验收** —— computed style 报「1px solid」,放大 8 倍截图后是纯白(被子元素覆盖)。
4. **每步断言前提** —— 曾三次「点了个空」还报绿:目标 y=1083 超视口 900、窗口在副屏 x=-1623、
   元素滚出可视区。`uiprobe.assert_in_viewport()` 就是为此。

### 5.2 修改纪律

1. 发现有害 pattern → **全仓 grep 同类逐个评估**,不能只改复现路径那一处
   (`flex-row-reverse` 修了又复发,就是只改了触发点)。
2. **新增功能必须回归它影响的既有交互** —— 「窄窗口自动收起侧栏」劫持了用户的手动 toggle,
   8 条单测全绿却没抓到,因为测的是纯函数、bug 在接线时序。该功能已回退。
3. 渲染条件依赖桌面环境的约束,**e2e 原理上抓不到**(`Show when={isDesktop()}` 子树在 web e2e 不渲染),
   必须上**源码级静态守卫**(见 `packages/app/src/pages/session/no-row-reverse.test.ts`)。
4. 守卫要做**反向验证** —— 故意注入违规确认它会红,否则可能是装饰品。

### 5.3 排查纪律(这条上个 session 反复违反)

**先测,再猜。** 典型反例:CDP 超时那次,依次猜「改坏了 find_element」「DOM 太大」「正则回退有问题」——
**三个方向全错**,真因是测多窗口后留下第二个 page target、工具连到了被节流的后台窗口。
绕了十几轮。正确做法是第一时间去看 target 列表 / 量基础 evaluate 耗时。

**工具报「未找到」不等于功能坏了。** `uiprobe.find_element` 现在会区分「DOM 中不存在」与
「存在但不可见(附原因)」,并自动截图。先看这个定性,再决定要不要动代码。

## 六、待办

1. 补齐第 2 组两个 SKIP 项的前提后重验。
2. 按 CHECKLIST 推进第 3~7 组(会话与聊天 / 文件预览 / 创作与供应商 / 飞书桥接 / 设置与全局)。
   建议照 `run_group2.py` 的三态模式为每组写执行脚本。
3. 全部验完后:补 changelog、由 user 决定是否合 main 与 push。
4. `UIPROBE.md` §四列了**还需补的 6 项工具能力**,按价值排序,可择机做
   (最高价值是「双版本对照跑」—— 把基准版比对机械化)。

## 七、给 user 的提醒

- 合 main、push **都需要你逐次点头**,agent 不会自动做。
- 目前累计 22 笔 commit 全在分支上,随时可整体丢弃或重来。
- local 版与你的正式版**数据、身份、配置三层隔离**(本轮刚补上配置那层),测试不会打扰你工作。
