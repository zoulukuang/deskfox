// [fork-only] media-gen — 内置专业模型目录(Layer 1)
// [feat: media-creation-mode] 2026-05-26
//
// 这是"创作模式"下拉里能选哪些专业模型的真相源(只读,随插件发布)。
// 对应需求规格 OPENCODE-PLAN/多模态创作模式/模型填入机制-需求规格.md §5。
// 用户连了某供应商(auth.json 有 key)→ 该供应商在此目录里的模型自动"亮起来"(见 registry.ts)。

// FORK: 加 tts_clone / tts_design 两档 [feat: media-gen-xiaomi] 2026-05-28
// 起源:小米 MiMo VoiceClone / VoiceDesign 跟普通 TTS 行为本质不同(克隆要参考音频、设计要描述声线),
// 硬塞进 tts 字段会污染语义。新增独立 capability 类型,UI 各起新档位 + 独立输入控件。
export type Capability =
  | "image"
  | "image_edit"
  | "video"
  | "video_i2v"
  | "tts"
  | "tts_clone"
  | "tts_design"
  | "asr"
  | "translate"

export const CAPABILITY_LABEL: Record<Capability, string> = {
  image: "文生图",
  image_edit: "图片编辑",
  video: "文生视频",
  video_i2v: "图生视频",
  tts: "配音",
  tts_clone: "语音克隆",
  tts_design: "语音设计",
  asr: "转写",
  translate: "专业翻译",
}

export type CatalogEntry = {
  id: string // 全局唯一,如 "alibaba-wanx2.1-t2i-turbo"
  capability: Capability
  provider: string // 供应商显示名
  providerKey: string // auth.json 键名,用于判可用 + 取 key
  model: string // 厂商模型 id
  displayName: string // 下拉显示名
  isDefault?: boolean // 该 capability 的缺省主模型
  // FORK: 人类可读的踩坑/决策备注,随数据一起走 [feat: media-catalog-data-extract] 2026-06-01
  // 抽数据到 catalog.data.json 后,原内联注释里有价值的部分落到这个字段保留。
  note?: string
  params?: {
    sizes?: string[]
    voices?: string[]
    needFile?: "image" | "audio" // 需素材(图片编辑/图生视频/转写/语音克隆)→ 输入框 ＋ 高亮
    // FORK: VoiceDesign 用 [feat: media-gen-xiaomi] —— UI 显示"声线描述"输入框
    voiceDesignHint?: boolean
  }
}

// providerKey 常量:auth.json 键名,判可用 + 取 key 用,dispatch.ts 依赖,保留导出。
// 供应商显示名(原 ALIBABA / MINIMAX / XIAOMI 等常量)随数据搬进 catalog.data.json 后已无引用,移除。
// [feat: media-catalog-data-extract] 2026-06-01
export const ALIBABA_KEY = "alibaba-cn"
// 对齐 opencode 上游 minimax auth 默认 id(配套 Coding Plan 套餐)
export const MINIMAX_KEY = "minimax-cn-coding-plan"
// 对齐 opencode 上游 xiaomi auth id(配套 Token Plan 套餐)
export const XIAOMI_KEY = "xiaomi-token-plan-cn"

// FORK-BEGIN: 模型目录数据抽到 catalog.data.json [feat: media-catalog-data-extract] 2026-06-01
// 阶段 1(数据/代码分层):BUILTIN_CATALOG 的"数据"部分移到同目录 catalog.data.json(纯数据,
// 受 catalog.schema.json 约束,catalog-data.test.ts 校验),"代码/类型"留本文件。
// 运行时读法不变:Bun.build 把 JSON 内联进单文件 plugin.js,这里 import 后原样导出。
// 不在运行时做 schema 校验(保持与抽取前行为一致,零新增风险);校验在测试/打包期跑。
// 完整背景:OPENCODE-PLAN/需求池/媒体模型适配-数据代码分层与开源registry.md
//
// 注:provider 显示名 / providerKey 在 JSON 里是字面量;ALIBABA / MINIMAX / XIAOMI 等常量
// 仍保留导出(dispatch.ts 等依赖),只是数据本体不再引用它们。
import catalogData from "./catalog.data.json"

// JSON 的 capability/needFile 推断为 string,与 Capability/字面量联合类型不等价,
// 经 catalog-data.test.ts 校验后用 unknown 跨过结构性差异。
/** 内置目录(阿里 8 + MiniMax 3 + 小米 MiMo 4,均已 probe 实测,详见 REQ-030)。数据源:catalog.data.json */
export const BUILTIN_CATALOG: CatalogEntry[] = catalogData as unknown as CatalogEntry[]
// FORK-END
