// [fork-only] 创作模式状态 + 编排(模块级单例,供 prompt-input 的模式栏 + 结果区共享)
// [feat: media-creation-mode] 2026-05-26
//
// createMode = null 表示普通 Chat(prompt-input 一切照旧);设为某能力 = 进创作模式。
// runCreation 读 prompt 文本 + 已选模型/参数 → 调 media-creation 客户端(本地服务)→ 把结果卡推进 cards。
// 结果本地渲染(不写入 opencode session,符合需求规格 §8.2)。

import { createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import {
  generateMedia,
  listMediaModels,
  type MediaCapability,
  type MediaGenInput,
  type MediaModel,
  type MediaResult,
} from "@/utils/media-creation"

export type { MediaCapability, MediaModel } from "@/utils/media-creation"

/** 模式菜单顺序(措辞/i18n 以后再调)*/
export const CREATION_MODES: { capability: MediaCapability; label: string }[] = [
  { capability: "image", label: "文生图" },
  { capability: "image_edit", label: "图片编辑" },
  { capability: "video", label: "文生视频" },
  { capability: "video_i2v", label: "图生视频" },
  { capability: "tts", label: "语音合成" },
  { capability: "asr", label: "语音识别" },
  { capability: "translate", label: "专业翻译" },
]

export type CreationCard = {
  id: string
  status: "running" | "done" | "error"
  capability: MediaCapability
  modelName: string
  prompt?: string
  inputThumb?: string // 输入参考图缩略图(改图/图生视频时的 ＋ 图,base64)
  progress?: string
  result?: MediaResult
  error?: string
}

// null = Chat(默认);否则是当前创作能力
const [createMode, setCreateMode] = createSignal<MediaCapability | null>(null)
const [models, setModels] = createSignal<MediaModel[]>([])
const [selected, setSelected] = createStore<Partial<Record<MediaCapability, string>>>({})
const [voiceSel, setVoiceSel] = createSignal<string | undefined>(undefined)

// FORK: 创作卡按"作用域"隔离(session id;首页/无 session 用 DRAFT_SCOPE),否则模块级全局
// store 会让一次创作后的卡在所有 session / 新建会话里都冒出来。session 页用 setScope 切换、
// resetScope 清空(新建会话)、adoptDraftInto 把首页 draft 卡过继给刚建出的 session。
// [bug-repro: 启动过创作后,打开任何新会话/新绘画都带出旧创作记录]
export const DRAFT_SCOPE = "__draft__"
const [cardsByScope, setCardsByScope] = createStore<Record<string, CreationCard[]>>({ [DRAFT_SCOPE]: [] })
const [activeScope, setActiveScope] = createSignal<string>(DRAFT_SCOPE)

export const creation = {
  createMode,
  models,

  /** 当前作用域(当前 session / 首页 draft)的创作卡 — 响应式 accessor */
  cards: (): CreationCard[] => cardsByScope[activeScope()] ?? [],

  DRAFT_SCOPE,

  /** session 页驱动:切到某 session(传 session id)或首页 draft(传 DRAFT_SCOPE)作用域 */
  setScope(key: string) {
    if (!cardsByScope[key]) setCardsByScope(key, [])
    setActiveScope(key)
  },

  /** 清空某作用域的卡(新建会话进 draft 时用) */
  resetScope(key: string) {
    setCardsByScope(key, [])
  },

  /** 首页 draft 创作 → 发 chat 建出 session 时,把 draft 卡过继给新 session,draft 清空 */
  adoptDraftInto(key: string) {
    const draft = cardsByScope[DRAFT_SCOPE] ?? []
    if (draft.length > 0) {
      setCardsByScope(key, [...(cardsByScope[key] ?? []), ...draft])
      setCardsByScope(DRAFT_SCOPE, [])
    }
  },

  /** 进/出创作模式;退出传 null = 回 Chat */
  setMode(cap: MediaCapability | null) {
    setCreateMode(cap)
  },

  /** 拉取可用模型;边车服务可能晚于 UI 就绪,故重试几次(拿到非空即停) */
  async loadModels() {
    for (let i = 0; i < 6; i++) {
      try {
        const list = await listMediaModels()
        if (list.length > 0) {
          setModels(list)
          return
        }
      } catch {
        /* 服务未就绪,稍后重试 */
      }
      await new Promise((r) => setTimeout(r, 800))
    }
    // 最后一次(允许空 — 可能确实没配任何已适配供应商)
    try {
      setModels(await listMediaModels())
    } catch {
      setModels([])
    }
  },

  /** 某能力下可用模型 */
  modelsFor(cap: MediaCapability): MediaModel[] {
    return models().filter((m) => m.capability === cap)
  },

  /** 哪些能力当前可用(决定模式菜单显示哪些档) */
  availableModes() {
    const caps = new Set(models().map((m) => m.capability))
    return CREATION_MODES.filter((m) => caps.has(m.capability))
  },

  /** 当前能力选中的模型(缺省 = isDefault 或第一个) */
  selectedModel(cap: MediaCapability): MediaModel | undefined {
    const list = creation.modelsFor(cap)
    const id = selected[cap]
    return list.find((m) => m.id === id) ?? list.find((m) => m.isDefault) ?? list[0]
  },

  selectModel(cap: MediaCapability, id: string) {
    setSelected(cap, id)
  },

  setVoice(v: string) {
    setVoiceSel(v)
  },
  /** 当前(语音合成)选中的音色;缺省该模型第一个音色 */
  currentVoice(cap: MediaCapability): string | undefined {
    const voices = creation.selectedModel(cap)?.params?.voices ?? []
    const v = voiceSel()
    return v && voices.includes(v) ? v : voices[0]
  },

  /** 触发一次生成:推一张 running 卡 → SSE 更新 → done/error;projectDir=当前项目根(落盘位置)。
   *  opts.generate 仅供单测注入(默认走真实 generateMedia) */
  async runCreation(
    entry: MediaModel,
    input: MediaGenInput,
    projectDir?: string,
    opts?: { generate?: typeof generateMedia },
  ) {
    const generate = opts?.generate ?? generateMedia
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const inputThumb = input.refFile?.startsWith("data:image") ? input.refFile : undefined
    // 绑定到发起时的作用域 — 生成期间即使切走也回填到正确 session/draft
    const scope = activeScope()
    if (!cardsByScope[scope]) setCardsByScope(scope, [])
    setCardsByScope(
      scope,
      produce((arr) => {
        arr.push({
          id,
          status: "running",
          capability: entry.capability,
          modelName: entry.displayName,
          prompt: input.prompt,
          inputThumb,
          progress: "提交中…",
        })
      }),
    )
    const patch = (fn: (c: CreationCard) => void) => {
      const arr = cardsByScope[scope] ?? []
      const i = arr.findIndex((c) => c.id === id)
      if (i >= 0) setCardsByScope(scope, i, produce(fn))
    }
    try {
      const result = await generate(entry.id, input, {
        projectDir,
        onProgress: (p) => patch((c) => (c.progress = p.message ?? p.state)),
      })
      patch((c) => {
        c.status = "done"
        c.result = result
        c.progress = undefined
      })
    } catch (e) {
      patch((c) => {
        c.status = "error"
        c.error = (e as Error).message
        c.progress = undefined
      })
    }
  },
}
