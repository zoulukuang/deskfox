feat-id: external-drop-path-ref
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动日志

## 一句话

从访达拖进聊天框的**非图片文件改走路径引用**(与文件树内拖一致),于是**任何类型都拖得进来**;
顺手修掉一个被白名单掩盖的 bug:图片能力拦截原先对所有附件生效。

## 改动文件

| 文件 | 性质 | 行数 |
|---|---|---|
| `packages/app/src/components/prompt-input/external-drop.ts` | **新增(fork-only)** | +81 |
| `packages/app/src/components/prompt-input/external-drop.test.ts` | **新增(测试)** | +115 |
| `packages/app/src/components/prompt-input/attachments.ts` | 上游文件,少量接线 | ~+25 / -5 |
| `docs/features/external-drop-path-ref/{1-spec,2-plan,3-changelog}.md` | 新增文档 | — |

新增 / 改上游 ≈ 196 / 30 ≈ **6.5 : 1**,优于 R1 的 3:1 健康基线。

## 行为变化(用户可见)

| 场景 | 改动前 | 改动后 |
|---|---|---|
| 拖 `.docx` / `.zip` / 任意二进制 | ❌ 弹「不支持」,进不来 | ✅ 进输入区,成为 `@路径` 引用 |
| 拖 `.csv` / `.txt` | 内联进消息(base64) | ✅ 改为 `@路径` 引用 |
| 拖 `.png` / 截图粘贴 | 内联图片附件 | **不变**(视觉模型要字节) |
| 浏览器拖来的虚拟文件(无路径) | 走白名单内联 | **不变**(回落原逻辑) |
| 模型不支持图片时拖 `.txt` | ❌ 被拦 + 弹「模型不支持图片」 | ✅ 正常进入(**bug 修复**) |

**已知中间态**:二进制拖进来后,agent 仍读不了(`read` 工具硬拒二进制),
会明确报错而不是静默失败。完整解法是档二(把内置 LibreOffice 接成 agent 工具),
已入 [需求池](../../../../OPENCODE-PLAN/需求池/拖入任意文件-文档提取工具链.md)。

## 回归

- 新增单测 16 条(L1–L8 路由 / R1–R3c 拦截范围),全过
- typecheck 通过
- app 包全量对照:改动前 874 pass / 12 fail → 改动后 **890 pass / 12 fail**,失败项完全相同(既有基线红)
- 真机(重建 local 包后):第 2 组 **7/7**、第 3 组 **16 通过 2 跳过**、第 4 组 **11/11**

## 回退方法

`git revert <本 commit>` 即可 —— 改动集中,`attachments.ts` 只有三处接线,
新文件删掉不影响任何既有路径。

## 依赖与合并顺序

⚠️ 本改动基于 `sync/upstream-2026-08-10`(上游 v1.18.16 把附件改成 blob 化,
`attachments.ts` 与 main 差 180 行)。**必须在该同步合入之后再合 main**,
否则会与 main 上的旧版 `attachments.ts` 冲突。

## 待人工验收(系统级拖放 CDP 喂不进去)

见 `packages/branding/smoke/MANUAL-CHECKLIST.md` #9a:

- [ ] M1 从访达拖 `.docx` → 输入区出现 `@路径` 引用,不报「不支持」
- [ ] M2 拖 `.png` → 仍是图片附件卡片
- [ ] M3 拖多个混合类型 → 图片走附件、其余走引用,互不干扰
- [ ] M4 项目外文件 → agent 读取时出现 `external_directory` 权限询问
