feat-id: model-capability-ui
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

## 改动清单

| 改动 | 说明 |
|---|---|
| user config(仓外) | getbot 7 视觉模型加 modalities + 删 4 死 ID;备份 `~/.config/opencode/opencode.jsonc.bak-pre-req026-20260802`;`alibaba-cn` 同名模型未实测不动 |
| `components/model-capability.ts` | 新增 fork-only:image/tools/reasoning 三态判定纯函数 |
| `components/model-capability.test.ts` | T1-T4 |
| `prompt-input/attachments.ts` | add() 拦截 + 多文件分流 toast(FORK marker) |
| `dialog-select-model.tsx` | 行内 📷/🧠 徽标(FORK marker) |
| i18n ×3 | toast ×2 + badge ×2 |

## 决策轨迹

- **拦截三态**:仅 `false` 拦,`unknown` 放行 —— 拿不到能力数据时误拦比漏拦伤害大(后端 ERROR 兜底仍在)。
- **🔧 徽标剔除**:provider capability merge 里 `toolcall ?? true` 默认真,几乎全员亮 = 噪音;徽标只留差异点 📷/🧠。
- **toast 一键切换按钮不做**(留 follow-up):toast API 支持 actions,但从 attachments 层拉起模型选择器需引 dialog/popover 上下文,侵入大于收益;文案已指引「切到带 📷 徽标的模型」。
- **数据补齐只动 getbot 块**:python 文本手术保留 jsonc 注释,改后用 comment-strip 解析验证(7 视觉 OK / 4 死 ID 移除 / alibaba-cn 25 模型未动)。
- 「先贴图后换模型」显式接受走后端 ERROR 兜底(spec/二次复核注意 4)。
