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
  params?: {
    sizes?: string[]
    voices?: string[]
    needFile?: "image" | "audio" // 需素材(图片编辑/图生视频/转写/语音克隆)→ 输入框 ＋ 高亮
    // FORK: VoiceDesign 用 [feat: media-gen-xiaomi] —— UI 显示"声线描述"输入框
    voiceDesignHint?: boolean
  }
}

const ALIBABA = "通义万相"
export const ALIBABA_KEY = "alibaba-cn"

// FORK: 第二家 provider 接入 [feat: media-gen-minimax] 2026-05-28
const MINIMAX = "MiniMax"
const MINIMAX_HAILUO = "MiniMax·海螺"
// 对齐 opencode 上游 minimax auth 默认 id(配套 Coding Plan 套餐)
export const MINIMAX_KEY = "minimax-cn-coding-plan"

// FORK: 第三家 provider 接入 [feat: media-gen-xiaomi] 2026-05-28
const XIAOMI = "小米 MiMo"
// 对齐 opencode 上游 xiaomi auth id(配套 Token Plan 套餐)
export const XIAOMI_KEY = "xiaomi-token-plan-cn"

/** 内置目录(首批 = 阿里 8 模型,均已 probe 实测,详见 REQ-030 §0.4/§0.5) */
export const BUILTIN_CATALOG: CatalogEntry[] = [
  {
    id: "alibaba-wanx2.1-t2i-turbo",
    capability: "image",
    provider: ALIBABA,
    providerKey: ALIBABA_KEY,
    model: "wanx2.1-t2i-turbo",
    displayName: "通义万相·文生图(快)",
    isDefault: true,
    params: { sizes: ["1024*1024", "1280*720", "720*1280"] },
  },
  {
    id: "alibaba-wanx2.1-t2i-plus",
    capability: "image",
    provider: ALIBABA,
    providerKey: ALIBABA_KEY,
    model: "wanx2.1-t2i-plus",
    displayName: "通义万相·文生图(高清)",
    params: { sizes: ["1024*1024", "1280*720", "720*1280"] },
  },
  {
    id: "alibaba-qwen-image-edit",
    capability: "image_edit",
    provider: ALIBABA,
    providerKey: ALIBABA_KEY,
    model: "qwen-image-edit",
    displayName: "通义万相·图片编辑",
    isDefault: true,
    params: { needFile: "image" },
  },
  {
    id: "alibaba-wanx2.1-t2v-turbo",
    capability: "video",
    provider: ALIBABA,
    providerKey: ALIBABA_KEY,
    model: "wanx2.1-t2v-turbo",
    displayName: "通义万相·文生视频",
    isDefault: true,
    params: { sizes: ["1280*720", "720*1280"] },
  },
  {
    id: "alibaba-wanx2.1-i2v-turbo",
    capability: "video_i2v",
    provider: ALIBABA,
    providerKey: ALIBABA_KEY,
    model: "wanx2.1-i2v-turbo",
    displayName: "通义万相·图生视频",
    isDefault: true,
    params: { needFile: "image" },
  },
  {
    id: "alibaba-qwen-tts",
    capability: "tts",
    provider: "通义",
    providerKey: ALIBABA_KEY,
    model: "qwen-tts",
    displayName: "通义·配音(qwen-tts)",
    isDefault: true,
    params: { voices: ["Cherry", "Serena", "Ethan", "Chelsie"] },
  },
  {
    id: "alibaba-paraformer-v2",
    capability: "asr",
    provider: "通义",
    providerKey: ALIBABA_KEY,
    model: "paraformer-v2",
    displayName: "通义·转写(paraformer-v2)",
    isDefault: true,
    params: { needFile: "audio" },
  },
  {
    id: "alibaba-qwen-mt-turbo",
    capability: "translate",
    provider: "通义",
    providerKey: ALIBABA_KEY,
    model: "qwen-mt-turbo",
    displayName: "通义·专业翻译(qwen-mt)",
    isDefault: true,
  },
  // FORK: MiniMax 接入 — image-01 / Hailuo-02 / speech-02-turbo [feat: media-gen-minimax] 2026-05-28
  {
    id: "minimax-image-01",
    capability: "image",
    provider: MINIMAX,
    providerKey: MINIMAX_KEY,
    model: "image-01",
    displayName: "MiniMax·文生图(image-01)",
    // 不标 isDefault — 阿里 wanx2.1-t2i-turbo 已是默认,MiniMax 作为可选第二档
    params: { sizes: ["1024*1024", "1280*720", "720*1280"] },
  },
  {
    id: "minimax-hailuo-2.3",
    capability: "video",
    provider: MINIMAX_HAILUO,
    providerKey: MINIMAX_KEY,
    model: "MiniMax-Hailuo-2.3", // 2026-05-28 实测真实 API id(文档写 Hailuo-2.3 / Hailuo-2.3-Fast,实际带 MiniMax- 前缀)
    displayName: "海螺·文生视频(Hailuo-2.3)",
    params: { sizes: ["768P", "1080P"] },
  },
  {
    id: "minimax-speech-2.8-hd",
    capability: "tts",
    provider: MINIMAX,
    providerKey: MINIMAX_KEY,
    // 2026-05-28 实测确认:Token Plan 走 -hd 后缀(speech-2.8-hd / 2.6-hd / 02-hd),-turbo 走积分计费。
    // FAQ 原文:"Token Plan 支持的非语言模型包括: TTS HD (speech-2.8-hd / speech-2.6-hd / speech-02-hd)..."
    model: "speech-2.8-hd",
    displayName: "MiniMax·配音(speech-2.8-hd)",
    params: { voices: ["male-qn-qingse", "female-shaonv", "male-qn-jingying", "female-tianmei"] },
  },
  // FORK: 小米 MiMo 接入 — 3 档 TTS + Omni 当 ASR [feat: media-gen-xiaomi] 2026-05-28
  // 限免:TTS 三档 Token Plan 不消耗额度;ASR 走 Omni(mimo-v2.5)消耗 1x token
  {
    id: "xiaomi-mimo-v2.5-tts",
    capability: "tts",
    provider: XIAOMI,
    providerKey: XIAOMI_KEY,
    model: "mimo-v2.5-tts",
    displayName: "MiMo·配音(预设音色)",
    // 不标 isDefault — 阿里 qwen-tts 已是默认,小米作为可选第三档
    // voices 全集(probe 阶段查官方):中文 冰糖/茉莉/苏打/白桦/MimoDefault/DefaultZh,英文 Chloe/Mia/Milo/Dean/DefaultEn
    params: { voices: ["茉莉", "冰糖", "苏打", "白桦", "Chloe", "Mia", "Milo", "Dean", "MimoDefault"] },
  },
  {
    id: "xiaomi-mimo-v2.5-tts-voiceclone",
    capability: "tts_clone",
    provider: XIAOMI,
    providerKey: XIAOMI_KEY,
    model: "mimo-v2.5-tts-voiceclone",
    displayName: "MiMo·语音克隆",
    isDefault: true, // tts_clone capability 目前只此一家,自动是默认
    params: { needFile: "audio" },
  },
  {
    id: "xiaomi-mimo-v2.5-tts-voicedesign",
    capability: "tts_design",
    provider: XIAOMI,
    providerKey: XIAOMI_KEY,
    model: "mimo-v2.5-tts-voicedesign",
    displayName: "MiMo·语音设计",
    isDefault: true, // tts_design capability 目前只此一家
    params: { voiceDesignHint: true },
  },
  {
    id: "xiaomi-mimo-v2.5-asr",
    capability: "asr",
    provider: XIAOMI,
    providerKey: XIAOMI_KEY,
    // 用 Omni 当 ASR — mimo-v2.5-asr 直 model id 在 Token Plan 没暴露(probe 实测 "Not supported model")
    model: "mimo-v2.5",
    displayName: "MiMo·转写(Omni)",
    // 不标 isDefault — 阿里 paraformer-v2 已是默认且更快(1-3s vs 此 7.8s)
    params: { needFile: "audio" },
  },
]
