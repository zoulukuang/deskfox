feat-id: imbot-agent-schema-upgrade
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-094 imbot agent 自动升级(`_schemaVersion`)

## 需求

DeskFox 升级带新 imbot agent spec(权限档位调整)时,存量用户 config 里的旧 imbot agent 不会更新:`injectImbotAgent` 见 `"imbot" in agent` 完全跳过 → 升级不生效,新档位只对新装用户生效。

## 现状(源码复查实锤)

Electron 落点 `packages/desktop/src/main/deskfox/plugin-install.ts`(`injectImbotAgent` L196-203,调用链 `main/index.ts:318` 每次启动),原样保留 Tauri 版「已有完全跳过」语义。`_schemaVersion` 未知键安全性已确认:core agent schema `StructWithRest`(`core/src/v1/config/agent.ts:12`),未知键不校验失败。

## 方案(定稿,merge 字段表按二次复核钉死)

- spec 加 `_schemaVersion = 3`(对应现 v3 极简档);
- 升级三分支:无 imbot → 整体注入;`_schemaVersion` 缺失或 < 当前 → **字段级 merge**;≥ 当前 → skip(零写盘);
- **merge 字段表(钉死)**:spec 管理键 `_schemaVersion` / `description` / `permission` → 覆盖(安全语义收敛 + 档位文档跟版);**其余一切键**(`model` / `prompt` / `tools` / 任何用户自增)→ 原样保留;
- imbot 值形状异常(非对象)→ 不动不覆盖(防丢 user 数据),记日志;
- 纯逻辑抽 `imbot-agent.ts`(无 electron 依赖,可单测),plugin-install.ts 引用。

## 测试用例(R8,动工前锁定)

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| T1 | 无 imbot → 注入完整 spec 含 `_schemaVersion:3` | unit | changed=true |
| T2 | 旧 V2 残留(无 `_schemaVersion`)→ 升级,permission/description 覆盖 | unit | changed=true |
| T3 | 升级时用户自增键(model/prompt/tools)原样保留 | unit | 字段表生效 |
| T4 | `_schemaVersion` 等于当前 → skip,对象零改动 | unit | changed=false(零写盘) |
| T5 | `_schemaVersion` 高于当前(降级安装)→ 不动 | unit | changed=false |
| T6 | imbot 值形状异常(字符串/数组)→ 不动 | unit | 防御 |
| T7 | 手动构造 V2 残留 jsonc → 启动后升 V3 | 真机 QA(端到端阶段) | 验收门槛 |

## 影响范围

`packages/desktop/src/main/deskfox/`(fork-only,非黑名单)。行为变化:用户直改 imbot.permission 会在下次升级被覆盖一次(doc 既定接受,release notes 注明「自定义请另起 agent 名」)。
