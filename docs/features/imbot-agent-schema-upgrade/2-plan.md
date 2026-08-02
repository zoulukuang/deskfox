feat-id: imbot-agent-schema-upgrade
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

## 改动清单

| 文件 | 改动 |
|---|---|
| `packages/desktop/src/main/deskfox/imbot-agent.ts` | 新增:spec(含 `_schemaVersion:3`)+ `injectImbotAgent` 三分支升级(纯逻辑,无 electron 依赖) |
| `packages/desktop/src/main/deskfox/imbot-agent.test.ts` | 新增:T1-T6 |
| `packages/desktop/src/main/deskfox/plugin-install.ts` | 删本地 spec/inject 函数,改 import(调用链 `ensureDeskfoxPlugins` 不变,`changed` 标志天然保证同版本零写盘) |

## 决策轨迹

- **merge 字段表修订**(相对二次复核初稿):`description` 从「尊重用户」移入「覆盖」—— 它是 spec 的档位文档,不覆盖则永远停在旧档描述;`tools` 从「覆盖」移入「保留」—— spec 根本不定义 tools,强行覆盖(删除)会毁掉 spec 声明范围之外的用户自定义。最终语义:**spec 管理键(_schemaVersion/description/permission)覆盖,其余一切保留**。OPENCODE-PLAN 需求计划已同步修订。
- 抽纯逻辑文件而非在 plugin-install.ts 内测:该文件顶层 `import { app } from "electron"`,bun test 起不来;fs-probe.ts 抽离先例。
- 形状异常(imbot 是字符串/数组)不覆盖:防御 user 手写坏 config 时丢数据,保持 ensureDeskfoxPlugins 外层 try/catch 日志可见。
- 高版本不回退:降级安装老 DeskFox 不应把用户 config 拉回旧档。
