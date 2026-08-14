feat-id: external-drop-path-ref
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 外部拖入改走路径引用(档一)

> 2026-08-14 立。user 提出「从软件外部拖文件进来支持的格式有限(csv 能进、doc 进不去),
> 应该支持所有文件类型」。经评估拆成三档,**本文件只做档一**;
> 档二(LibreOffice 接成 agent 工具)+ 档三(通用提取器 + 批量授权)已入
> [需求池](../../../../OPENCODE-PLAN/需求池/拖入任意文件-文档提取工具链.md)。

## 一、问题

外部拖入与文件树内拖入是**两条完全不同的路径**:

| | 文件树内拖 / `@` 提及 | 从访达拖入 |
|---|---|---|
| 传什么 | **路径**:`{type:"file", path, content:"@path"}` | **内容**:整个文件 base64 内联进消息 |
| 类型限制 | 无 | `attachmentMime()` 白名单:图片 / pdf / `text/*` / 文本嗅探 |
| 上限 | 无 | 20 MB |
| 谁读 | agent 用 read 工具自己读 | 模型直接吃 base64 |

于是 `.csv` 能进(算 `text/*`)、`.docx` 进不去(二进制嗅探失败)。

**关键事实**:外部拖**其实已经拿到了真实路径**(`getPathForFile` → `sourcePath` 字段),
只是没拿它当引用用。所以档一本质是**接线**,不是造轮子。

## 二、目标(只做这些)

1. 外部拖入的**非图片**文件,改走**路径引用**(与文件树内拖一致)→ 所有类型都拖得进来。
2. **图片仍然内联** —— 视觉模型要的是字节,且粘贴截图本来就没有路径。
3. 修一个被白名单掩盖的 bug:`isImageBlocked` 拦截**对所有附件生效**而非只图片。

## 三、明确不做(避免范围蔓延)

- **不做**格式提取(docx → 文本)。档一之后二进制的表现是「拖得进来,但 agent 说读不了」,
  这是**已知且可接受**的中间态 —— 完整解法在档二。
- 不改文件树内拖、不改 `@` 提及、不改粘贴。
- 不动 20 MB 上限(它只约束内联路径,路径引用天然不受限)。

## 四、设计

新增 fork-only 纯函数模块 `prompt-input/external-drop.ts`:

```ts
export type DropRoute = { kind: "path"; path: string } | { kind: "inline" }

export function routeExternalDrop(file: { type: string; name: string; path?: string }): DropRoute
```

规则(顺序即优先级):

1. **是图片** → `inline`(mime 命中 `image/*` 白名单,或扩展名是 png/jpg/jpeg/gif/webp)
2. **拿得到路径** → `path`
3. 其余 → `inline`(回落原有 `attachmentMime` 白名单逻辑,行为与今天一致)

抽成纯函数是为了能离线单测 —— 拖放本身是系统级交互,e2e 喂不进去(见
`MANUAL-CHECKLIST.md` #9a),路由逻辑必须靠单测钉死。

`isImageBlocked` 改为**只在该附件确实是图片时**才拦。

## 五、验收用例(R8:动工前列,逐条可勾选)

### Logic(单测,`external-drop.test.ts`)

- [x] L1 png/jpeg/gif/webp **有路径** → 仍 `inline`(图片不改道)
- [x] L2 png **无路径**(粘贴截图)→ `inline`
- [x] L3 `.docx` 有路径 → `path`
- [x] L4 `.csv` 有路径 → `path`(**行为变化**:此前是 inline,现在统一走引用)
- [x] L5 `.zip` / 任意二进制 有路径 → `path`(不再被拒)
- [x] L6 任意类型 **无路径** → `inline`(回落,保持今天行为)
- [x] L7 mime 为空但扩展名是 `.PNG`(大写)→ 认作图片 → `inline`
- [x] L8 路径为空串 → 视作无路径 → `inline`(不能产出空路径引用)

### 回归(单测,`attachments.test.ts` 补)

- [x] R1 [bug-repro] 模型不支持图片时,**非图片**附件不该被拦
- [x] R2 模型不支持图片时,**图片**附件仍然被拦(原行为不许回退)

### 真机(`run_group3.py` / 人工)

- [ ] M1 从访达拖 `.docx` 进聊天框 → 输入区出现 `@路径` 引用,不报「不支持」
- [ ] M2 从访达拖 `.png` → 仍是图片附件卡片(不是路径引用)
- [ ] M3 拖多个混合类型 → 图片走附件、其余走引用,互不干扰
- [ ] M4 项目外文件 → agent 读取时出现 `external_directory` 权限询问

## 六、风险

- **引用是弱引用**:文件被删/改名后引用失效;会话导出到别的机器打不开。
  档一接受此代价(与文件树内拖同构),完整方案见档二/档三讨论。
- **权限面**:项目外路径读取会触发 `external_directory` 询问。机制已存在,
  但「拖 N 个文件 = N 次询问」的体验问题留给档三。
- **上游分叉**:主体逻辑放**新文件**,`attachments.ts` 只做少量接线(R1 三级跳第 2 档)。

## 七、依赖

本改动基于 `sync/upstream-2026-08-10`(上游 v1.18.16 把附件改成了 blob 化,
`attachments.ts` 与 main 差 180 行)。**必须在该同步合入之后再合 main。**
