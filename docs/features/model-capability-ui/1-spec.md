feat-id: model-capability-ui
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-026 模型能力-UI 对齐(modalities / 能力徽标)

## 需求

不支持图片的模型收到粘贴图片时静默降级(后端把图替换成 ERROR 文本塞进 prompt),用户看到缩略图以为发出去了,模型回复答非所问 →「发图不识别」无从解释;模型选择器无能力标识,无法预判。

## 三层根因(池文档 + 源码复查实锤)

1. user config getbot 模型全缺 `modalities` → `provider.ts` merge 链(config → models.dev → false)落 false(getbot 非 models.dev 注册商);
2. `transform.ts unsupportedParts` 把不支持的图替换成 ERROR 文本(silent fallback);
3. `attachments.ts add()` 只按 mime 拦,不查模型能力;选择器无徽标。

## 方案(定稿)

- **Phase 0 数据补齐(user config,不动代码)**:getbot 7 个实测视觉模型加 `modalities:{input:["text","image"],output:["text"]}`;删 4 个死 ID(MiniMax-M2.7/qvq-max/qwen-deep-search/qwen3-coder-480b)。`alibaba-cn` 供应商同名模型不动(未实测,超出池文档范围)。
- **② 前端拦截**:`attachments.ts` add() 查当前模型 image 能力,明确 false → toast「当前模型不支持图片」拦下;能力未知(拿不到模型/字段缺失)→ 保守放行走后端 ERROR 兜底。能力判定抽纯函数 `model-capability.ts`。
- **③ 选择器徽标**:`dialog-select-model.tsx` 列表行加 📷/🧠 徽标(复用 Tag;🔧 刻意不做 —— capability merge 里 toolcall 默认 true 几乎全员亮 = 噪音,徽标只留差异点)。
- 「先贴图后换模型」路径显式接受走后端兜底(二次复核注意 4);toast 一键切换按钮留 follow-up。

## 测试用例(R8,动工前锁定)

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| T1 | `modelSupportsImage`:capabilities.input.image true/false | unit | true/false |
| T2 | capabilities 缺失回落 modalities.input 数组 | unit | includes("image") |
| T3 | 模型为空 / 两字段都缺 → "unknown"(不拦) | unit | 保守放行 |
| T4 | tools/reasoning 判定同三态 | unit | 徽标数据源 |
| T5 | add() 在模型明确不支持时返回 false 且不入 prompt(toast 路径) | unit(逻辑层验证)/ CDP | 拦截生效 |
| T6 | getbot 视觉模型粘图正确识别;非视觉模型粘图 toast 拦截,请求体无 ERROR 文本 | 真机 QA | 验收门槛 |
| T7 | 徽标与 config 一致;claude-code 系列回归不变 | CDP / 真机 | 验收门槛 |

## 影响范围

user config(仓外,有备份)+ `attachments.ts` / `dialog-select-model.tsx`(上游文件,FORK marker)+ fork-only 纯函数 + i18n×3。getbot 上游模型增删仍需手工补 modalities(config 内已有注释约定,未决项保留)。
