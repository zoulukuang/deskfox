// [fork-only] media-gen — opencode plugin 入口(阿里全能力:图/视频/翻译/语音合成/语音识别)
// [feat: media-gen-alibaba] 2026-05-26
//
// 跑在 opencode-cli sidecar 进程内。注册 5 个工具,AI 按用户意图自动调用。
// 0 修改上游 / DeskFox 主程序。装载见 opencode.jsonc 的 plugin 数组(指向 dist/plugin.js)。

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { tool } from "./tool-shim"
import { ALIBABA_PROVIDER_ID, readProviderApiKey } from "./auth"
import { DashScopeError } from "./dashscope-task"
import { DEFAULT_MODEL, generateImage } from "./dashscope-image"
import { DEFAULT_EDIT_MODEL, editImage } from "./dashscope-edit"
import { generateVideo } from "./dashscope-video"
import { synthesizeSpeech } from "./dashscope-tts"
import { translateText } from "./dashscope-translate"
import { transcribeAudio } from "./dashscope-asr"

const NO_KEY = "未找到阿里(alibaba-cn)的 API Key。请先在 DeskFox 设置里连接阿里供应商。"
const fail = (e: unknown) => `操作失败:${e instanceof DashScopeError ? e.friendly : (e as Error).message}`

export const MediaGenPlugin = async (_input: PluginInput): Promise<Hooks> => {
  return {
    tool: {
      media_image_generate: tool({
        description: [
          "从文字描述生成【全新】图片(文生图)。用户要画图、绘图、生成图片、做配图/头像/插画/海报时使用。",
          "当前接入阿里通义万相。注意:要修改/编辑【已有】的图片(如换背景、改颜色、增删元素)请改用 media_image_edit,不要用本工具。",
          "也不要用于:截图保存、复制粘贴文件。",
        ].join(" "),
        args: {
          prompt: tool.schema.string().describe("图片内容描述,中文或英文均可,越具体越好"),
          model: tool.schema.string().optional().describe(`可选模型,缺省 ${DEFAULT_MODEL}(高清档传 wanx2.1-t2i-plus)`),
          size: tool.schema.string().optional().describe("可选尺寸 宽x高,默认 1024x1024"),
          n: tool.schema.number().int().min(1).max(4).optional().describe("可选生成数量 1-4,默认 1"),
        },
        async execute(args, ctx) {
          const apiKey = readProviderApiKey(ALIBABA_PROVIDER_ID)
          if (!apiKey) return NO_KEY
          ctx.metadata({ title: "提交生图任务…" })
          try {
            const r = await generateImage({
              apiKey,
              prompt: args.prompt,
              model: args.model,
              size: args.size,
              n: args.n,
              signal: ctx.abort,
              onProgress: (p) => ctx.metadata({ title: p.message, metadata: { state: p.state } }),
            })
            return {
              output: `已用 ${r.model} 生成 ${r.urls.length} 张图片:\n${r.urls.map((u) => `![](${u})`).join("\n")}`,
              metadata: { kind: "image", provider: "alibaba", model: r.model, urls: r.urls, taskId: r.taskId },
            }
          } catch (e) {
            return fail(e)
          }
        },
      }),

      media_image_edit: tool({
        description: [
          "编辑 / 修改【已有】的图片。用户要改背景、换颜色、替换或增删元素、局部修改、风格化一张现有图片时,必须用本工具。",
          "典型场景:把背景换成绿色 / 荷花、给人物加顶帽子、把白天改成夜晚、去掉某个物体。当前接入阿里通义万相 wanx2.1-imageedit。",
          "需要用户提供这张图(放进 image 参数):本地文件路径(包括 @ 提及的文件)或公网 URL,本地文件会自动上传处理。",
        ].join(" "),
        args: {
          prompt: tool.schema.string().describe("要怎么改这张图,如 '把背景换成绿色'、'给狗戴上墨镜'"),
          image: tool.schema.string().describe("要编辑的图片:本地文件路径(@ 提及的文件)或公网 URL"),
          model: tool.schema.string().optional().describe(`可选模型,缺省 ${DEFAULT_EDIT_MODEL}`),
        },
        async execute(args, ctx) {
          const apiKey = readProviderApiKey(ALIBABA_PROVIDER_ID)
          if (!apiKey) return NO_KEY
          ctx.metadata({ title: "改图中…" })
          try {
            const r = await editImage({
              apiKey,
              prompt: args.prompt,
              image: args.image,
              model: args.model,
              signal: ctx.abort,
            })
            return {
              output: `已改图:\n![](${r.url})`,
              metadata: { kind: "image-edit", provider: "alibaba", model: r.model, url: r.url },
            }
          } catch (e) {
            return fail(e)
          }
        },
      }),

      media_video_generate: tool({
        description: [
          "生成视频。用户要做视频、生成动画、让图片动起来时使用;",
          "若提供参考图(refImage,公网 URL)则图生视频,否则文生视频。当前接入阿里通义万相,需等 1-3 分钟。",
        ].join(" "),
        args: {
          prompt: tool.schema.string().describe("视频内容/动作描述"),
          model: tool.schema.string().optional().describe("可选模型,缺省按是否有参考图选 t2v/i2v turbo"),
          refImage: tool.schema.string().optional().describe("可选,首帧参考图的公网 URL;给了就让这张图动起来"),
          size: tool.schema.string().optional().describe("可选尺寸,默认 1280x720(仅文生视频用)"),
        },
        async execute(args, ctx) {
          const apiKey = readProviderApiKey(ALIBABA_PROVIDER_ID)
          if (!apiKey) return NO_KEY
          ctx.metadata({ title: "提交视频任务(约 1-3 分钟)…" })
          try {
            const r = await generateVideo({
              apiKey,
              prompt: args.prompt,
              model: args.model,
              refImage: args.refImage,
              size: args.size,
              signal: ctx.abort,
              onProgress: (p) => ctx.metadata({ title: p.message, metadata: { state: p.state } }),
            })
            return {
              output: `已用 ${r.model} 生成视频:\n${r.url}`,
              metadata: { kind: "video", provider: "alibaba", model: r.model, url: r.url, taskId: r.taskId },
            }
          } catch (e) {
            return fail(e)
          }
        },
      }),

      media_translate: tool({
        description: "专业翻译文本。用户要翻译一段文字时使用。基于阿里 qwen-mt 翻译模型,质量优于普通聊天翻译。",
        args: {
          text: tool.schema.string().describe("要翻译的原文"),
          targetLang: tool.schema.string().describe('目标语言,如 "English" / "Chinese" / "Japanese"'),
          sourceLang: tool.schema.string().optional().describe("可选源语言,缺省自动识别"),
        },
        async execute(args) {
          const apiKey = readProviderApiKey(ALIBABA_PROVIDER_ID)
          if (!apiKey) return NO_KEY
          try {
            const r = await translateText({
              apiKey,
              text: args.text,
              targetLang: args.targetLang,
              sourceLang: args.sourceLang,
            })
            return { output: r.text, metadata: { kind: "translate", provider: "alibaba", model: r.model } }
          } catch (e) {
            return fail(e)
          }
        },
      }),

      media_tts: tool({
        description: "把文字转成语音(语音合成 / TTS)。用户要朗读、配音、生成语音时使用。返回音频链接。基于阿里 qwen-tts。",
        args: {
          text: tool.schema.string().describe("要合成语音的文字"),
          voice: tool.schema.string().optional().describe("可选音色,如 Cherry / Serena / Ethan / Chelsie,缺省 Cherry"),
        },
        async execute(args, ctx) {
          const apiKey = readProviderApiKey(ALIBABA_PROVIDER_ID)
          if (!apiKey) return NO_KEY
          ctx.metadata({ title: "合成语音…" })
          try {
            const r = await synthesizeSpeech({ apiKey, text: args.text, voice: args.voice, signal: ctx.abort })
            return {
              output: `已合成语音(音色 ${r.voice}):\n${r.url}`,
              metadata: { kind: "tts", provider: "alibaba", model: r.model, url: r.url },
            }
          } catch (e) {
            return fail(e)
          }
        },
      }),

      media_asr: tool({
        description: "把语音转成文字(语音识别 / ASR)。用户给出音频链接、要求转写/听写时使用。基于阿里 paraformer。",
        args: {
          audioUrl: tool.schema.string().describe("公网可访问的音频文件 URL(wav/mp3 等)"),
          model: tool.schema.string().optional().describe("可选模型,缺省 paraformer-v2"),
        },
        async execute(args, ctx) {
          const apiKey = readProviderApiKey(ALIBABA_PROVIDER_ID)
          if (!apiKey) return NO_KEY
          ctx.metadata({ title: "识别语音…" })
          try {
            const r = await transcribeAudio({
              apiKey,
              audioUrl: args.audioUrl,
              model: args.model,
              signal: ctx.abort,
              onProgress: (p) => ctx.metadata({ title: p.message, metadata: { state: p.state } }),
            })
            return { output: `识别结果:\n${r.text}`, metadata: { kind: "asr", provider: "alibaba", model: r.model } }
          } catch (e) {
            return fail(e)
          }
        },
      }),
    },
  }
}

export default MediaGenPlugin
export const server = MediaGenPlugin
