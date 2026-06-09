---
feat-id: home-empty-onboarding-copy
status: done
related: ./3-changelog.md
---

# 3-changelog — home-empty-onboarding-copy

> Tiny 规模(纯 i18n 文案 + 1 行组件 key 切换),按规范只写 3-changelog.md。
> 需求:用户**没有打开任何项目**时的首页空状态,文案对齐首次引导设计稿
> `D:\project\OPENCODE-PLAN\首次引导\onboarding-final.html`(只学文案,不学配色/用途)。
> 「最近项目」区域(有项目时的列表)**不动**,只改其上方的空状态欢迎文案。

## 需求与决策

设计稿空状态文案三句,user 拍板套用其中三处、并去掉底部 hint:

| 位置 | 旧文案(en/zh) | 新文案(zh) |
|---|---|---|
| 标题 `home.empty.title` | No recent projects / 没有最近项目 | **你的专属 AI 工作助理已就绪** |
| 副标题 `home.empty.description` | Get started by opening a local project / 通过打开本地项目开始使用 | **将本地项目文件夹交给 Fox，它将深度理解你的项目结构，随时为你提供帮助** |
| 按钮(新 key `home.empty.open`) | (原复用 `command.project.open`「打开项目」) | **打开项目文件夹** |

- user 决策①:套设计稿三处文案,**去掉**底部提示「选择目标文件夹后，确认打开即可」。
- user 决策②:**全部 17 种语言**都翻这套新文案。
- 空状态按钮新建独立 key `home.empty.open`(「打开项目文件夹」),与「最近项目」头部按钮仍用的 `command.project.open`(「打开项目」)区分开 —— 后者不动。

## 改法

| 文件 | 改动 |
|---|---|
| `packages/app/src/i18n/{17 langs}.ts` | 每个语言文件改 `home.empty.title` / `home.empty.description` 两值 + 新增 `home.empty.open` 一行。共 17 文件。 |
| `packages/app/src/pages/home.tsx` | 空状态(`<Match when={true}>`)按钮文案由 `command.project.open` → `home.empty.open`,加 FORK marker。其它两个状态(有最近项目 / 加载中)的按钮不动。 |

### FORK marker 约定

沿用既有惯例:i18n 仅 **en / zh / zht 三主力语言**打 FORK marker(全仓现状这三个文件各 15 处 marker,其余 14 语言文件 0 marker,按"批量译文不逐一标"对待)。

- en / zh / zht:三行新文案用 `FORK-BEGIN / FORK-END` 块包裹。
- 其余 14 语言:跟随既有惯例不加 marker。
- `home.tsx`(纯净上游文件,0 marker)按 R2 加单行 `{/* FORK: ... */}`。

## 验证

- i18n 全套测试(completeness + rebrand)**15 pass / 0 fail** —— 新 key `home.empty.open` 在 17 语言齐全,completeness 通过。
- app 包 typecheck `tsgo -b` 通过(0 error)。
- ⚠️ 空状态界面**视觉呈现**需「无任何最近项目」时才显示,真桌面渲染对齐待 user 在 release exe 上 QA(对照 [[feedback_cdp_selftest_complements_not_replaces_qa]] —— 文案/键值正确性测试已覆盖,视觉对齐属真桌面范畴)。

## 规模 / 影响

- **Tiny**:18 文件(17 i18n + 1 组件),净 ~59 行,几乎全是文案值;`home.tsx` 仅 1 行 key 切换 + marker。
- **回退**:`git revert` 本 commit;恢复后空状态退回「没有最近项目 / 通过打开本地项目开始使用」+ 按钮「打开项目」。
- **上游侵入**:`home.tsx` 1 行(已 marker)+ en/zh/zht 文案值改(已 marker);其余为译文值改动。**0 R4 override / 0 黑名单**。
