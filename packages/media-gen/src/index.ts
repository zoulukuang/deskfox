// [fork-only] media-gen — opencode plugin 入口(第一竖切:阿里文生图)
// [feat: media-gen-alibaba] 2026-05-26
//
// 跑在 opencode-cli sidecar 进程内。注册 1 个工具 media_image_generate,
// AI 在 user 说"画一张…"时自动调用。0 修改上游 / DeskFox 主程序。
//
// 开发期装载:user `~/.config/opencode/opencode.jsonc` 的 plugin 数组加:
//   "file:///D:/project/opencode-fork/packages/media-gen/src/index.ts"
// 然后杀 + 重开 DeskFox(插件运行时加载,无需重新编译 App)。

import { tool, type Hooks, type PluginInput } from "@opencode-ai/plugin"
import { ALIBABA_PROVIDER_ID, readProviderApiKey } from "./auth"
import { DashScopeError, DEFAULT_MODEL, generateImage } from "./dashscope-image"

export const MediaGenPlugin = async (_input: PluginInput): Promise<Hooks> => {
  return {
    tool: {
      media_image_generate: tool({
        description: [
          "生成图片(文生图)。当用户要求画图、绘图、生成图片、做配图、设计头像/插画/海报等时使用。",
          "当前接入阿里通义万相(DashScope),异步生成并返回图片链接,通常 30-60 秒。",
          "不要用于:截图保存、复制粘贴文件、把已有图片写到磁盘——那些请用文件/bash 工具。",
        ].join(" "),
        args: {
          prompt: tool.schema.string().describe("图片内容描述,中文或英文均可,越具体越好"),
          model: tool.schema.string().optional().describe(`可选,生图模型 ID,缺省 ${DEFAULT_MODEL}`),
          size: tool.schema.string().optional().describe("可选,尺寸 宽x高,默认 1024x1024"),
          n: tool.schema.number().int().min(1).max(4).optional().describe("可选,生成数量 1-4,默认 1"),
        },
        async execute(args, ctx) {
          const apiKey = readProviderApiKey(ALIBABA_PROVIDER_ID)
          if (!apiKey) {
            return "未找到阿里(alibaba-cn)的 API Key。请先在 DeskFox 设置里连接阿里供应商,再让我画图。"
          }

          ctx.metadata({ title: "提交生图任务…" })
          try {
            const result = await generateImage({
              apiKey,
              prompt: args.prompt,
              model: args.model,
              size: args.size,
              n: args.n,
              signal: ctx.abort,
              onProgress: (p) => ctx.metadata({ title: p.message, metadata: { state: p.state } }),
            })
            const md = result.urls.map((u) => `![](${u})`).join("\n")
            return {
              output: `已用 ${result.model} 生成 ${result.urls.length} 张图片:\n${md}`,
              metadata: {
                provider: "alibaba",
                model: result.model,
                urls: result.urls,
                taskId: result.taskId,
              },
            }
          } catch (e) {
            const msg = e instanceof DashScopeError ? e.friendly : (e as Error).message
            return `生图失败:${msg}`
          }
        },
      }),
    },
  }
}

export default MediaGenPlugin
export const server = MediaGenPlugin
