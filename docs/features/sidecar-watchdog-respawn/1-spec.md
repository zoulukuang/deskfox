feat-id: sidecar-watchdog-respawn
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# sidecar 看门狗自动重启 + 插件截流(REQ-049 Layer③ + Layer①)

> 上游需求母体:`OPENCODE-PLAN/需求池/sidecar-OOM崩溃-四层防御加固.md`(REQ-049)
> 本 feat 落地其中 **Layer③(看门狗自愈,本仓)** + **Layer①(插件截流,deskfox-plugins 仓)**。

## 背景 / 问题

2026-06-03 实地事件:用户在 DeskFox 内置聊天发起重型任务(经 `claude-code` provider 插件调起 Claude Code,后者自主开多阶段 Workflow)。claude 喷出海量 stream-json 事件 → 插件逐条转发给 opencode sidecar → 单进程内存撑爆崩溃(exit `0x80000003`)。连锁:
- 主进程**只打日志不重启** → 32225 端口无人监听 → 前台所有文件/AI 请求 `error sending request` → 卡死、停止键空转;
- 内存被撑爆**殃及整机**(飞书桌面端白屏)。

根因详见 REQ-049。本 feat 取其中两层(性价比最高、纯 fork 可控):

## 验收标准

### Layer③ 看门狗(本仓 opencode-fork)
- sidecar 崩溃/假死后,主进程**自动同 port + 同 password 重启**,前台请求自动恢复,无需用户重开 app
- 覆盖两类故障:① 进程崩死 ② 进程在但 `/global/health` 无响应(hang)
- **熔断**:确定性崩溃下不进入 restart storm(窗口内超阈值则放弃 + 告警)
- **不误重启**:用户主动 quit / kill 时看门狗不得重启
- 前台对"重启中/已恢复/重启失败"有可见提示(体感;功能恢复不依赖它)

### Layer① 插件截流(deskfox-plugins/claude-code)
- claude 海量 reasoning / 大工具结果 / 大入参在"进 sidecar 之前"被有界化
- **绝不影响**:最终答案文本、工具实际执行(均 providerExecuted)

## R8 测试用例清单(动工前定)

| # | 验什么 | 层级 | 预期 |
|---|---|---|---|
| 1 | firehose-guard reasoning 未超限原样转发 | unit | 原文返回 |
| 2 | reasoning 越限 → 一次提示后全丢 | unit | 越线返回提示,之后空串 |
| 3 | clampToolInput 超长字符串截断 + 附提示 | unit | 截断 + "已截断 N 字符" |
| 4 | clampToolInput 递归只动字符串、结构/非字符串不变 | unit | 数字/bool/null 原样,嵌套字符串截断 |
| 5 | 看门狗熔断:窗口内达上限触发 | unit(Rust) | `over_restart_budget` 返回 true |
| 6 | 看门狗熔断:窗口外重启不计入 | unit(Rust) | 返回 false |
| 7 | **行为:杀掉 sidecar → 看门狗 ~15s 内重启,前台恢复** | 真桌面(release) | 端口重新监听 + 提示弹出 + 请求恢复 |
| 8 | **行为:连续秒杀 sidecar 多次 → 触发熔断不空转** | 真桌面(release) | 熔断日志 + "重启失败"提示 |
| 9 | **行为:正常 quit DeskFox → 看门狗不重启** | 真桌面(release) | 无 respawn 日志,进程干净退出 |

> #1-#6 unit 可自动跑(#1-#4 已在 deskfox-plugins `bun test` 绿;#5-#6 Rust 编译通过,Tauri lib 测试 exe 受沙箱 WebView2 DLL 限制无法启动,逻辑等价手验)。
> #7-#9 是看门狗真正验收闸,需 release 包行为测试(对照"CDP 自测 ≠ 真桌面 QA")。

## 架构选型(R1 三级跳)
- Layer①:**全在插件新文件** `firehose-guard.ts`(纯函数)+ 接入点 6 处 → 1 级(新文件为主)
- Layer③:看门狗主体在 `server.rs` 新增函数(FORK-BEGIN/END);`lib.rs` 仅 ≤10 行接线(ServerState 加字段 + initialize 接线 + kill_sidecar 置标记)→ 2 级(新增为主 + 上游少量注入)
- **选轮询式看门狗**而非 Terminated-事件式:不碰脆弱的启动竞速路径,且额外覆盖"假死 hang"。Terminated 即时检测列为后续增强(REQ-049 补丁1)。
