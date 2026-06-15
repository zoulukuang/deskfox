feat-id: fox-blue-theme
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# Fox Blue 主题 — changelog

## 概述

基于默认主题 **OC-2** 复制新主题 **Fox Blue**(浅色),把选中态底色/开关 ON/文件树文字色改成品牌 logo 蓝(Cool Blue `#7295c4`)并加 hover 三档反馈;深色暂与 OC-2 一致。**0 上游源文件改动**(全 fork-only 新文件 + fork CSS)。

## 改动文件

| 文件 | 类型 | 说明 | 约行数 |
|---|---|---|---|
| `packages/ui/src/theme/themes/fox-blue.json` | 新增(fork-only) | OC-2 逐字节克隆,仅 `name="Fox Blue"`/`id="fox-blue"` 不同;被 `context.tsx` glob 自动发现入选择器 | 468 (数据克隆) |
| `packages/branding/src/theme.css` | 改(fork-only) | 加 fox-blue scoped 块(4 组规则,scope=`html[data-theme="fox-blue"][data-color-scheme="light"]`) | +~50 |
| `packages/ui/src/theme/themes/fox-blue.test.ts` | 新增(fork-only) | clone 完整性:除 name/id 外与 OC-2 全等 + 身份字段断言;守上游 merge 漂移 | +33 |
| `.husky/pre-commit` | 改(fork 治理) | EXCEPTION_REGEX 加 fork 主题文件豁免(注册型扩展点,同 provider-icons 道理,user 拍板)— 主题靠 glob 自动发现,fork 主题=往 themes/ 丢 json;精确豁免 `fox-blue.(json\|test.ts)`,上游主题 json 仍受保护 | +1 行 regex +4 行注释 |
| `docs/features/fox-blue-theme/{1-spec,2-plan,3-changelog}.md` | 新增 | 三件套 | — |
| `docs/features/INDEX.md` | 改 | 加 feat 索引行 | +1 |

> **黑名单豁免说明(替代 R4 override)**:`fox-blue.json` 必须落在受保护的 `packages/ui/src/theme/themes/`(主题 glob 目录)。经 user 拍板,认定为**注册型扩展点**(延续规范 v2 对 provider-icons sprite/types 的同类豁免),把 fork 主题文件精确加进 pre-commit EXCEPTION_REGEX,而非走 R4 override → **不占用 override 配额**,未来加 fork 主题同样干净。

## 蓝色覆盖明细(branding/theme.css,均仅浅色)

1. `--surface-base-active` → `rgba(114,149,196,0.32)` —— 文件树 / 会话列表 / 设置左导航 三处选中行共用此 token,一处覆盖三处;hover 走 `--surface-base-hover` 不受影响。
2. `[data-component="switch"][data-checked] [data-slot="switch-control"]` → 实心 `#7295c4` —— 开关 ON(原 `--icon-strong-base` 近黑;该 token 共享给图标/正文,故走选择器)。
3. `[data-tree-path] .text-text-weak` → `color: var(--text-strong)` —— 文件树「所有文件」文字色对齐会话列表(#171717);只改色,字号/字重保留;诊断色(inline)/ ignored(`.text-text-weaker`)不动。
4. 三档 hover/选中蓝(文件树 `[data-tree-path]` / 会话列表 `[data-session-id]` / 设置导航 `tabs[settings]`):hover 未选中 `0.12` / 选中 `0.32`(token)/ 选中+hover `0.44`。hover 规则与上游各自 `hover:bg-*` 命中同元素同时机,仅换色,不引入新行为。

## commit

- `<待填>` on `feat/fox-blue-theme`:`feat(theme): Fox Blue 主题 — OC-2 克隆 + 选中态/开关/文件树 logo 蓝 + hover 三档 [feat: fox-blue-theme]`

## 影响范围

- 仅当用户在 设置→通用→主题 选择 **Fox Blue** 时生效;OC-2 及其他全部主题零影响。
- 深色模式选 Fox Blue = 当前等同 OC-2(无蓝覆盖)。
- 桌面渲染器(`packages/app`/`packages/ui`);TUI 不受影响(不走 glob 主题,且为 CSS 覆盖)。

## 回归测试

- `bun test packages/ui/src/theme/themes/fox-blue.test.ts` → 3 pass。
- CDP 实算(electron 直跑 `out/`,真实数据):选中蓝 `#7295c452` / 开关 ON `rgb(114,149,196)` / 文件树文字 `rgb(23,23,23)` / hover `0.12` / 选中+hover `0.44` 全部符合预期。
- 真桌面 QA(视觉对齐 + 真实 hover 手感)待 user。

## 回退方法

- 删 `packages/ui/src/theme/themes/fox-blue.json` + `fox-blue.test.ts`,撤回 `branding/src/theme.css` 内 fox-blue scoped 块即可,单点可逆(P4);用户若已选 Fox Blue,删除后回退 OC-2(`context.tsx` `normalize`/fallback 兜底)。

## 已知遗留(非本 feat 阻塞)

- dev/prod 打包卡在与主题无关的 **icon 256x256 校验**报错(channel 图标产出 128px)→ 另记。
- 列表选中蓝为 alpha 浅调;深色版蓝待 user 决定 —— 详见 `2-plan.md` 遗留段。
