# Fork 主题制作指南(增加 / 修改自有主题)

> **用途**:在不改上游源码的前提下,给 DeskFox 增加或修改自有(fork)主题(如 Fox Blue)。
> **首个落地范例**:[`docs/features/fox-blue-theme/`](../features/fox-blue-theme/)(OC-2 克隆 + 选中态/开关/文件树 logo 蓝 + hover 三档)。
> **元原则**:稳定 > 简洁。主题是「换皮」性质改动 → 走配置(json)+ fork CSS,**0 改上游 token/组件**(R3 / P2)。

---

## 0. 一分钟速查(要加一个新 fork 主题,照这个做)

1. **复制基底主题** json → `packages/ui/src/theme/themes/<your-id>.json`,只改 `name` / `id` 两个字段(其余保持基底逐字节克隆)。
2. **颜色差异写 fork CSS**(不写进 json):在 `packages/branding/src/theme.css` 加 scope 块
   `html[data-theme="<your-id>"][data-color-scheme="light"] { … }`(深色同理换 `dark`)。
3. **放行黑名单**:`packages/ui/` 在 pre-commit 黑名单内 → 把新主题文件**精确**加进 `.husky/pre-commit` 的 `EXCEPTION_REGEX`(注册型扩展点,见 §5)。
4. **加 clone 完整性测试**(可选但推荐):`themes/<your-id>.test.ts`,断言除 name/id 外与基底全等(守上游 merge 漂移)。
5. **验证**:构建 renderer → CDP 切到该主题 → 读 computed 色值核对(见 §6)。
6. 三件套文档进 `docs/features/<feat-id>/`,INDEX 加行。

---

## 1. 主题系统怎么工作的(改之前必懂)

| 机制 | 位置 | 关键点 |
|---|---|---|
| **主题发现** | `packages/ui/src/theme/context.tsx` | `import.meta.glob("./themes/*.json")` **自动扫目录**(非递归)→ 往 `themes/` 丢一个 json 就自动进主题选择器。**不经 `default-themes.ts`**(那个只被 TUI 终端界面消费)。 |
| **主题名** | 同上 | `name(id) = store.themes[id]?.name ?? names[id] ?? id` → 取 json 的 `name` 字段即可,**不必**改 context.tsx 里的 `names` 表。 |
| **CSS 注入 + scope 钩子** | `applyThemeCss()` | 把 token 输出到 `:root`,并在 `<html>` 上设 **`data-theme="<id>"` + `data-color-scheme="light|dark"`** 两个属性 → 这就是 fork CSS 精确 scope 的锚点。 |
| **token 体系** | `themes/*.json` | 每个主题 = `light` / `dark` 两套,各含 `palette`(种子色)/ `overrides`(v1 token)/ `v2Overrides`(v2 token `--v2-*`)。 |

> **不要**改 `default-themes.ts` / context.tsx 的 `names` 表来加桌面主题 —— glob + json `name` 已够,改它们是无谓的上游侵入。

## 2. 颜色差异:写 json 还是写 fork CSS?

**默认写 fork CSS**(`packages/branding/src/theme.css`,已在 `app/src/index.css` import),理由:

- json 保持基底**纯克隆** → 上游改基底主题时,clone 测试会红,提示「需重新同步」,而不是悄悄漂移。
- 所有差异集中一处(branding CSS),可读、可逆、易 review。
- fork CSS 用 `html[data-theme="<id>"]` 前缀,特异度高于上游 `:root` / 组件 CSS,**稳压**且只在该主题激活时生效。

**例外**:若差异是「整套换色板」(几十个 token),可以直接改 json 的 `overrides`/`v2Overrides`(那本就是主题该做的)。**少量「某几处选中态/控件」的定向改色** → 走 CSS(避免共享 token 污染)。

## 3. token 覆盖 vs 选择器覆盖(关键决策)

改一个 token 会影响**所有**读它的 UI。改之前先判断该 token 是否被目标之外的 UI 共享:

- **token 语义恰好 = 你想改的那类 UI** → 直接覆盖 token(一处覆盖多处)。
  - 例:`--surface-base-active`(语义=激活态底色)被文件树/会话列表/设置导航选中行共用 → 覆盖它一次,三处全中,且 hover 走 `--surface-base-hover` 不受影响。
- **token 被无关 UI 共享**(图标/正文/通用 hover)→ **走选择器精确覆盖**,只动目标元素。
  - 例:开关 ON 原读 `--icon-strong-base`(还管图标/正文)→ 不能改 token,改 `[data-component="switch"][data-checked] [data-slot="switch-control"]`。

**判断方法**:`grep` 该 token 在 `packages/app/src` + `packages/ui/src` 的全部 callsite,数一下有没有目标之外的用途。

## 4. 稳定选择器锚点(选择器覆盖时用这些,别用易变的 tailwind 类)

| UI | 锚点选择器 | 选中态 | hover 态 |
|---|---|---|---|
| 文件树行 | `[data-tree-path]`(FORK 属性) | `.bg-surface-base-active` | `:hover` |
| 会话列表行 | `[data-session-id]` | `:has(.active)` | `:hover` |
| 设置左导航项 | `[data-component="tabs"][data-variant="settings"] [data-slot="tabs-trigger-wrapper"]` | `:has([data-selected])` | `:hover` |
| 开关(v1,设置页用) | `[data-component="switch"][data-checked] [data-slot="switch-control"]` | — | — |

> ⚠️ **组件多版本并存坑**:v1 (`components/*.tsx` + `*.css`) 与 v2 (`v2/components/*-v2.*`) 同时存在。设置弹窗(经典布局)用的是 **v1** `tabs` / `switch`(`data-component="tabs"` / `"switch"`),**不是** `tabs-v2` / `switch-v2`。**以运行时实际渲染的 `data-component` 为准**,别信静态搜索的首个命中(实测踩过此坑)。
> hover 规则要与上游各自的 `hover:bg-*` 命中**同一元素同一时机**,仅换色 → 不引入新 hover 行为。

## 5. 黑名单放行(注册型扩展点,user 拍板,非 R4 override)

`packages/ui/` 整个在 pre-commit 黑名单(`.husky/pre-commit` 的 `BLACKLIST_REGEX`)内,防误改上游。但新增 fork 主题文件是**注册型扩展点**(往固定目录丢 json 即自动注册),与规范 v2 对 `provider-icons` sprite/types 的豁免同理。

**做法**(已立先例,2026-06-15):把 fork 主题文件**精确**加进 `.husky/pre-commit` 的 `EXCEPTION_REGEX`,例:

```
…|^packages/ui/src/theme/themes/fox-blue\.(json|test\.ts)$
```

- **精确到文件名**(跟上游主题 oc-2/dracula… 0 重名)→ 上游主题 json 仍受保护,不会被「偷改」。
- 加新 fork 主题时**在此追加文件名**(同 provider-icons 的精确豁免风格)。
- 这样**不占用 R4 override 配额**(每季 ≤2)。**不要**为加主题走 `--no-verify [override-blacklist]`。
- `.husky/` 本身不在黑名单,可直接改。

> 若 json 行数使单次 commit 超 500 行阈值(4.2 软警告)→ 主题 json 是**数据克隆非逻辑**,走 hook 文档化的 `git commit --no-verify -m '… [large-diff: <理由>]'`。

## 6. 验证(View 层 = CDP 实算 + 真桌面 QA)

1. **构建 renderer**:`packages/desktop` 下 `OPENCODE_CHANNEL=dev bun run build`(改 ui/branding 都要重建,renderer 无 HMR)。
2. **跑起来 + CDP**:win-unpacked exe 或 `electron . --remote-debugging-port=9222`(后者直跑 `out/`,绕开打包,改 CSS/主题最快)。
3. **切主题**:CDP `localStorage.setItem('opencode-theme-id','<id>'); localStorage.setItem('opencode-color-scheme','light')` → `location.reload()`。
4. **读 computed 色值核对**(比截图可靠):`getComputedStyle(el).backgroundColor` / `getComputedStyle(documentElement).getPropertyValue('--token')`;Chrome 会把 `rgba()` 序列化成 8 位 hex(如 `#7295c452` = rgba(114,149,196,0.32)),核对时注意。
5. **真桌面 QA**:视觉对齐 + 真实 hover 手感只能真机验,CDP 实算 ≠ 真桌面 QA(见 CLAUDE.md 验证约定)。

## 7. 文档 + 提交

- 三件套进 `docs/features/<feat-id>/`,`docs/features/INDEX.md` 加行。
- commit message 带 `[feat: <feat-id>]`;改 `.husky/pre-commit` 在 changelog 记一笔(注册扩展点豁免,非 override)。

---

## 附:品牌蓝色板(取自 `packages/branding/src/theme.css`)

| 名称 | 浅色 | 用途 |
|---|---|---|
| Slate Navy | `#1f2d44` | logo 主体 / 主品牌面 |
| **Cool Blue** | **`#7295c4`** | logo「Fo」/嘴/链接 = **「logo 蓝」选定值**(Fox Blue 选中态/开关用它) |
| Light Blue | `#9dbbe3` | 高光 / Splash 左下三角 |
| Warm Coral | `#ff9a7a` | 珊瑚点缀(面积 ≤15%) |

> 深色有对应提亮映射,见 `theme.css` 的 `@media (prefers-color-scheme: dark)` 段。
