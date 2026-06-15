feat-id: deskfox-verify-chain
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 1-spec — DeskFox verify 链(一条命令、一个判定、按改动自动选层)

> 规模:Medium(`verify.ts` 401 行编排器 + `cold-start.py` 127 行 + 治理规范 v7)。
> 注:本三文档为**事后补齐**(代码已先行落地并合 main,commit `c2e30bf20`/`763c1eac4`/`faac87b19`,经 `368155e93` 合入)。补文档以对齐三文档规范 + 入 INDEX/改动日志,不改既有代码。

## 背景 / 问题

R9 要求「开发完按 R8 清单跑全套 + 全绿,问题在 feat 分支内解决,才向 user 提 merge」。但 DeskFox 的 View/CDP 那部分验收一直是**逐条人看**:typecheck、oxlint、CDP 冒烟(`smoke.py`)、冷启动健康(`cold-start-health-check.py`,还在 sibling repo OPENCODE-PLAN)、发布物校验,各跑各的、各看各的输出。user 是产能瓶颈,这种"每验收一次要逐条读输出"的方式吃他带宽,也容易漏。

并且有两类 bug 只有特定层级才暴露:
- **冷启动 sidecar 预热竞态**:sidecar HTTP 已起但内部未热 → 首个 `file.list` 返回 500 弹红 toast。reload(暖 sidecar)永远抓不到,只有真冷启动窗口暴露(2026-06-13 实战:user 报、暖态自测漏)。
- **发布物完整性**:`latest.yml` 的 sha512 与 exe 实算不一致(electron 自动升级命门,不一致=客户端下载后校验失败装不上)、版本号 0.0.0、`.blockmap` 缺、LibreOffice 没进包 —— 全是 dev 态测不到、只有真打成安装包才暴露的。

## 目标

把这些现成零件**编排成一条命令**,产出**单一退出码判定**,让"改完 → 自动验证 → 只推没过项"取代"逐条人看",把 user 复核从"逐条读"降为"只看没过项"。

## 验收标准 / 测试用例清单(R8)

| # | 验什么 | 层级 | 预期 |
|---|---|---|---|
| 1 | 一条命令跑通 L0+L2(默认) | 编排 | 退出码 0/2/1 对应 🟢/🟡/🔴 |
| 2 | `--changed` 按 git 改动自动选 probe | 编排·逻辑 | 只跑被碰到的面(boot/providers/panels/settings/files) |
| 3 | `--scope ui\|provider\|viewer\|all` / `--only <probe>` 选层 | 编排 | 映射正确,未知 probe/scope 报错 |
| 4 | 自动探活 9222,没起则后台拉 dev、跑完只杀自己拉起的 | 运行时 | 复用在跑的 dev 时自动剔 boot 免 reload 打断会话 |
| 5 | `--cold`(L1)真冷启动 | 运行时·native | 杀本项目进程(按命令行路径过滤,不误杀别的 electron)→ 真冷启 → `cold-start.py` 监控 ~22s,抓 sidecar 预热竞态;判定 🟢0/🔴1(无 🟡) |
| 6 | `cold-start.py` conn-refused 误报已修 | 逻辑 | 冷启预热窗口的 ERR_CONNECTION_REFUSED 单独计数,**终态已连上**才算瞬时;始终没连上才算真 FAIL(保留 sidecar 没起来的真检出) |
| 7 | `--release`/`--build`(L3)发布物校验 | 产物 | `dist-deskfox`:安装包存在 / **latest.yml sha512 与 exe 实算一致** / 版本非 0.0.0 / `.blockmap` / LO 进包;任一不过即 🔴 |
| 8 | electron-updater 口径 | 产物 | L3 查 `*.exe`+`latest.yml`+`.blockmap`,**不复用**已随换基座过时的 Tauri 版 `verify-updater-artifacts.ts`(那份查 `*-setup.exe`+`.sig`) |
| 9 | 验收铁律入规范 | 治理 | `自动化测试规范.md` R9 下加 callout + 修订记录 v7;🔴/L0 不过不进 merge,🟡 须 user 确认 |

## 架构选型

- **编排器** `packages/branding/smoke/verify.ts`(bun 脚本),四层正交:
  - **L0 静态**:`bun run typecheck`(turbo)+ `bun run lint`(oxlint)
  - **L1 冷启动**(`--cold`):杀全部进程 → 真冷启 dev → `cold-start.py` 监控
  - **L2 交互**:连 dev 的 CDP 9222,跑 `smoke.py` 相关 probe
  - **L3 发布物**(`--release`/`--build`):校验 `dist-deskfox` 产物
- **退出码即闸**:0=🟢 / 2=🟡(L2 软警告:空白/报错/弹窗没开)/ 1=🔴(L0 不过 / L2 crash / L3 任一不过)。可直接挂 agent / CI / ship 闸。
- **命令用全路径调用**(`bun run packages/branding/smoke/verify.ts`),**不注册 npm 别名** —— `package.json` 属上游同步黑名单,注册别名会增加跟随上游升级时的合并摩擦。
- **冷启动脚本自包含入仓**:从 OPENCODE-PLAN 诊断工具家迁入主仓 `packages/branding/smoke/cold-start.py`,让 L1 闸不依赖 sibling repo 在场。
