# 三端协作与 Agent 接入(李哲 / 笑南 / 鹏鹏)

> **状态**:活规则,2026-11-09 起生效(user 拍板「以仓库为公共语言」)
> **适用范围**:DeskFox 三人协作 —— 两台 Mac Mini + 一台 Windows;面向新接入的同事和他们的 Claude Code Agent
> **本文只回答一件事**:新来的人和 Agent 第一天怎么接上,以及三个 Agent 之间怎么交接、评审、验收。分支流程看 [`双端协作-SOP.md`](./双端协作-SOP.md),环境细节看 [`跨平台协作.md`](./跨平台协作.md),硬约束看 [`CLAUDE.md`](../../CLAUDE.md)。**不重复那些内容。**

---

## 一、谁在哪台电脑(统一称呼,三个仓库一致)

| 统一称呼 | 人 | 设备 | 在本仓的平台职责 |
|---|---|---|---|
| **李哲的电脑** | 李哲(owner,本人) | Mac Mini,`ComputerName` 为 `Zhe's Mac Mini`;登录账号 `xiaonan`,代码在 `/Volumes/xiaonan/code` | 开发;合 main / 推 main 的拍板(三条铁律) |
| **笑南的电脑** | 笑南 | Mac Mini,`ComputerName` 为 `岳笑南的Mac mini` | 开发;Mac 打包 / 签名 / 公证 / 上传(先例:`docs/features/release-2026.12.1/`) |
| **Windows 电脑** | 鹏鹏 | Windows 开发电脑 | **Windows 端开发负责人**(2026-11-09 本人定):Win 专属功能与 bug、Windows 打包与上传(`build-deskfox-electron.ps1`)、Win 真桌面 QA(`smoke.py` / 冷启动检查) |

**身份声明**:每个 Agent 接手任务时先核实自己跑在哪台电脑(macOS `scutil --get ComputerName`,Windows `$env:COMPUTERNAME`),在首次进度说明里写「当前身份:李哲的电脑 / 笑南的电脑 / Windows 电脑」之一;核实不了写「待确认」,不猜。不得用 Git 作者、账号名或仓库路径单独判定身份。交接、测试证据、台账一律用统一称呼并注明实际执行电脑。

---

## 二、第一天接入

### 2.1 三端共同

```bash
git clone git@github.com:zoulukuang/deskfox.git     # origin = GitHub 主仓;gitee 只是镜像,国内 clone 慢可先 clone gitee 再把 origin 改回 GitHub
cd deskfox
git config core.autocrlf false
git config core.quotepath false
bun install --frozen-lockfile                          # bun 版本以根 package.json 的 packageManager 为准(当前 1.3.14;2026-11 发版实测 1.4.x 装依赖失败)
bun run typecheck                                      # 全绿 = 环境通
```

- `bun install` 的 `prepare` 会装 husky,`.husky/pre-commit`(白黑名单 / diff 阈值 / 大小写冲突)与 `.husky/pre-push`(fork 范围 typecheck + 六包单测)自动生效;**不要 `--no-verify`**,要跳过必须在 commit message 里写明。
- 本机私有文件:`.claude/settings.local.json`、`.claude/commands/` 已 gitignore(双端同名异内容,故意不入仓);不要把它们加进来。
- 首次打开 Claude Code 的第一句话:**「先读 CLAUDE.md 和 docs/governance/三端协作-Agent接入.md,核实并声明当前电脑身份,再读 docs/features/INDEX.md 看 in-progress 的 feat。」**

### 2.2 Windows 电脑(鹏鹏)额外

```powershell
git config --global core.longpaths true
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force   # 管理员一次性
```

- Git for Windows 自带 Git Bash,husky 的 `.husky/*` 是 sh 脚本,靠它运行;Claude Code 用 Windows 原生版即可认领「Windows 电脑」,用 WSL 须在进度说明里写明宿主。
- 国内镜像:打包 wrapper(`build-deskfox-electron.ps1`)已配好镜像;**不要**全局设 `BUN_CONFIG_REGISTRY=npmmirror`,会撞 `desktop-build-blockers` 记录过的 sidecar 预发布版拉不到的坑。
- 接入自检:`packages\branding\scripts\build-deskfox-electron.ps1 -Env local -NoBundle` 能出 `win-unpacked` 即算通(local 档独立身份,不打扰正式版)。PS 5.1 若报 `NativeCommandError`,按 `CLAUDE.md`「验证约定」里的 Bash 直调方式。

### 2.3 笑南的电脑额外

- 已有发版职责,环境见 `docs/features/release-2026.12.1/3-changelog.md` 第三节(签名公证凭据在 `~/.deskfox-signing/`,不入仓)。
- 拉到本文后只需 `git pull` + 确认 `bun run typecheck` 仍绿,并在本文第六节修订记录下方「回执」加一行。

---

## 三、日常规则(只给指针,正本在各自文档)

| 事项 | 规则 | 正本 |
|---|---|---|
| 三条铁律 | 永不在 main 上开发;合 main、推 main 都要李哲同意。笑南 / 鹏鹏同样适用:feat 分支内 commit / push 自主,合 main 前在交接文件里写「待合并,交李哲」 | `CLAUDE.md`「默认仓库约定」 |
| 分支 | `feat/<全小写-kebab>` 一次性容器,从最新 main 切,合完即删;开工前先约定分支名防重名 | `双端协作-SOP.md` §1-3 |
| 文档 | 每 feat 一目录 `docs/features/<feat-id>/{1-spec,2-plan,3-changelog}.md`,commit 带 `[feat: <id>]`;Tiny 只写 3-changelog | `CLAUDE.md`「完整文档链路」 |
| 测试 | R5 / R8 / R9:新 feat 带测试、修 bug 先写复现、Medium+ 动工前列用例清单、分支内全绿才提合并 | `自动化测试规范.md` |
| 上游文件 | 改必加 FORK marker;黑名单走 R4 override | `改动规则.md` |

---

## 四、三个 Agent 之间怎么交接、评审、验收

**载体只有一个:`docs/features/<feat-id>/` 目录。** 聊天、微信、飞书只做「去看某个文件」的通知。

1. **交接**:写在该 feat 的 `3-changelog.md`「交接」节,或独立 `N-handoff.md`(先例:`upstream-sync-2026-08/5-handoff.md`、`6-windows-handoff.md`、`release-2026.12.1/3-changelog.md`)。必含五项:**接手人统一称呼 / 代码位置(分支 + commit)/ 已验到哪 / 剩下要做什么 / 怎么算验收**。同时在 `docs/features/INDEX.md` 该行简介末尾写「交 <称呼>」。
2. **委托评审**:接手方 Agent 用 Claude Code `/code-review <范围>`(例 `main..feat/x`)或人工读 diff,结论写回同一 feat 目录(先例:`release-2026.12.1/3-changelog.md` 第六节「review 留存项」),**不只留在聊天里**。
3. **回执**:接手方在交接文件末尾加 `## 回执(<称呼>,YYYY-MM-DD)`:做了什么、结果、commit、未做项。回执也是一笔 commit。
4. **验收**:`1-spec.md` 验收标准 + R8 用例清单全绿 + 真桌面 QA。**平台归属**:Windows 项只认 Windows 电脑的结果,Mac 项只认 Mac;「CDP 自测 ≠ 真桌面 QA」照旧。本人体验项由李哲做,Agent 不代替。
5. **开工前**:`git fetch` 后看 `docs/features/INDEX.md` 的 in-progress 行和最近 commit,有没有交给自己的事;避免两台电脑同时改同一 feat(`双端协作-SOP.md` §4.3)。

---

## 五、Windows 电脑(鹏鹏)的职责与典型任务

**鹏鹏是本仓 Windows 端开发负责人(2026-11-09 本人定)**;同一位同事在 fox-take 仓负责安卓开发。两台 Mac 负责 Mac 端与共享逻辑的主体开发,Mac 打包由笑南的电脑出。

- 每个发版的 **Windows 打包与上传**:`build-deskfox-electron.ps1 -Env prod`,步骤与台账见 `版本号与发布渠道规范.md`;Mac 包由笑南的电脑出,两端同号。
- **Win 真桌面 QA**:`python packages/branding/smoke/smoke.py`(CDP 冒烟)与冷启动健康检查(路径见 `CLAUDE.md`「验证约定」),结果写进该发版 feat 的 3-changelog。
- **Win 专属 bug**:路径 / IME / NSIS / updater / 托盘等,走正常 feat 流程;Mac 无法复现的要在 spec 里标「仅 Win」。
- 共享逻辑(app / core / adapter)的开发与两台 Mac 一样,不限平台。

---

## 六、修订记录

| 版本 | 日期 | 修订内容 |
|---|---|---|
| v1.0 | 2026-11-09 | 初版。起源:user 拍板三人(李哲 / 笑南 / 鹏鹏)跨 Mac / Windows 协作,Agent 之间也要能分工、评审、验收,先在 deskfox / fox-take / deskfox-operations 做样板。本文只做「接入 + Agent 交接协议」,不改既有 SOP。 |
| v1.1 | 2026-11-09 | 分工写死:鹏鹏 = Windows 端开发负责人(§一表、§五);去掉「2026-11-09 加入」的不准确表述(Windows 电脑 10 月底起已在 fox-take 做安卓开发)。 |

**回执**(接入后各加一行):
- 笑南的电脑(YYYY-MM-DD):待回填。
- Windows 电脑 / 鹏鹏(YYYY-MM-DD):待回填。
