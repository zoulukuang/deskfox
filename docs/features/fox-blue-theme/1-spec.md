feat-id: fox-blue-theme
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# Fox Blue 主题 — 需求 + 验收

## 背景 / 目标

user 要在默认主题 **OC-2** 基础上复制一个新主题 **Fox Blue**,唯一改动是把若干「选中态底色」从 OC-2 的灰/黑改成 **DeskFox 品牌 logo 蓝(Cool Blue `#7295c4`)**,其余一切继承 OC-2。后续追加两点:文件树文字色对齐会话列表、列表项 hover/选中三档蓝色反馈。

**深色模式暂与 OC-2 完全一致**(user 明确「新主题的深色和 OC-2 暂时保持一致」)→ 所有定制只作用于浅色。

## 需求清单(逐条可勾验收)

| # | 需求 | 验收(浅色) | 层级 |
|---|---|---|---|
| 1 | 文件树选中行底色 灰→logo 蓝 | 选中文件背景 = `rgba(114,149,196,0.32)` | View/CDP |
| 2 | 会话列表选中行底色 灰→logo 蓝 | 同上 | View/CDP |
| 3 | 设置左导航选中项底色 灰→logo 蓝 | 同上 | View/CDP |
| 4 | 开关(Switch)ON 态 黑→实心 logo 蓝 | switch ON control `background = rgb(114,149,196)` | View/CDP |
| 5 | 新主题出现在主题选择器,名「Fox Blue」 | 设置→通用→主题下拉含 Fox Blue,选中生效 | View/CDP |
| 6 | 深色模式 = OC-2(零差异) | `[data-color-scheme="dark"]` 下无任何蓝覆盖 | 代码审查 |
| 7 | 文件树「所有文件」文字色 = 会话列表文字色 | 文件树普通文件文字 `color = #171717`(`--text-strong`),与会话列表一致 | View/CDP |
| 8 | 列表项 hover → 较浅蓝(鼠标反馈) | 未选中行 hover bg = `rgba(114,149,196,0.12)` | View/CDP |
| 9 | 列表项 选中 → 较重蓝;选中再 hover → 更重蓝 | 选中非 hover=0.32 / 选中+hover=`rgba(114,149,196,0.44)`,三档层级清晰 | View/CDP |
| 10 | 「其他都不变」 | OC-2 及其他主题零改动;hover 蓝仅命中三个列表项,不波及普通按钮;诊断色/ignored 淡化保留 | 代码审查 |

## 架构选型(为什么这么做)

1. **新主题 = 纯新 json 文件**:运行时主题靠 `packages/ui/src/theme/context.tsx` 的 `import.meta.glob("./themes/*.json")` 自动发现,**只加 `themes/fox-blue.json`(OC-2 克隆,仅改 name/id)即自动入选择器**,`name` 取 json `name` 字段 → **零改上游 TS**(P1)。`DEFAULT_THEMES`/`default-themes.ts` 只被 TUI 消费,桌面不经它,故不动。
2. **蓝色差异 = fork CSS,不进 json**:`fox-blue.json` 保持 OC-2 逐字节克隆(便于上游 merge + clone 完整性测试守护);所有蓝色覆盖集中在 fork-only `packages/branding/src/theme.css`(已在 `app/src/index.css` import),scope 到运行时挂在 `<html>` 的 `data-theme="fox-blue"` + `data-color-scheme="light"`(R3:主题色走自己 CSS,不改上游 token 定义)。
3. **token vs 选择器**:选中态底色三处共用语义 token `--surface-base-active` → 改 token 一处覆盖三处;开关 ON 的 `--icon-strong-base` / 设置导航 hover 的共享 token 会污染图标/文字/其他 hover → 走**选择器精确覆盖**(锚点:`[data-tree-path]` / `[data-session-id]` / `[data-component="tabs"][data-variant="settings"]` / `[data-component="switch"][data-checked]`)。

## 规模 / 测试

- 规模:**Medium-light** — 1 新 json(数据克隆)+ branding CSS ~50 行 + 1 测试;**0 上游源文件改动**。
- 测试:① clone 完整性单测(`fox-blue.json` 除 name/id 外与 OC-2 全等,守上游 merge 漂移)② CDP 实算色值验证(10 条验收点全部 computed-value 取证)。深色零差异靠 `[data-color-scheme="light"]` scope 保证 + 代码审查。
