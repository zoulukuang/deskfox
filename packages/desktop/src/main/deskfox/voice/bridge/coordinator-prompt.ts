// [fork-only] voice-acp-bridge — coordinator 的路由引导 [feat: voice-acp-bridge] 2026-08-24
//
// coordinator 收到的是 qwen 的 4.8k 字请求信封,由真模型执行路由判断。qwen 那套指令只说
// "怎么用派活工具",**不说"什么样的活值得单独开一条 session"** —— 而后者正是 voice-dispatch-minimal
// 时代最大的体感问题:qwen 的判定阈值偏高,「分析今日A股盘面」(9 次工具调用、完整分析)都被
// 判成"其余任务"留在协调 session 里,于是那条会话变成几十件不相干事情的流水账,没法读、没法搜。
//
// 这段引导补的就是这个阈值。**与旧方案的关键差别:它只发给 coordinator。**
// 旧方案走 `config.instructions`,是**全局**的 —— 第三层 session 读同一份,所以不得不写一段
// 「先判断你是谁」的自我否定条款来防止执行者也去派活。新架构里派活工具只存在于 voice 目录
// (MCP 按 directory 隔离),第三层结构上就拿不到,这段话也就不必存在了:
// 少一段自相矛盾的 prompt,少一个模型读错的机会。

/**
 * 作为 `system` 追加给 coordinator 的每一轮 prompt(sidecar `PromptPayload.system`)。
 * 不覆盖任何内置 prompt,只加一段偏好说明。
 */
import { QWEN_MCP_SERVER_NAME, QWEN_MCP_TOOL_NAMES } from "./contract"

/**
 * 派活工具在 **sidecar 侧的真实名字**。
 *
 * sidecar 给每个 MCP 工具加 server 名前缀(`catalog.ts:119` 的
 * `sanitize(clientName) + "_" + sanitize(name)`),而 qwen 的工具名**本身**就带
 * `qwen_audio_agent_` —— 于是模型看到的是双前缀的
 * `qwen_audio_agent_qwen_audio_agent_session_start`。
 *
 * 2026-08-25 真机 QA:qwen 的信封里说的是 `session_start`,模型在 61 个工具里没认出
 * 那个双前缀的怪名字就是它,转头去调 bash/write 自己干(被拒后还编了个"已完成")。
 * 所以**把真名直接写进 prompt**,不让模型猜。
 */
const DELEGATE_TOOL = `${QWEN_MCP_SERVER_NAME}_${QWEN_MCP_TOOL_NAMES[1]}` // …_session_start
const CONTINUE_TOOL = `${QWEN_MCP_SERVER_NAME}_${QWEN_MCP_TOOL_NAMES[2]}` // …_session_send
const LIST_TOOL = `${QWEN_MCP_SERVER_NAME}_${QWEN_MCP_TOOL_NAMES[0]}` // …_sessions_list

/**
 * coordinator **不知道用户的项目在哪** —— 它自己的 cwd 是 voice 独立目录(递归防护的代价)。
 *
 * 2026-08-25 真机实撞的后果:它派活时把自己那个目录当成了"当前项目",任务文本写成
 * 「统计项目目录 `~/.local/share/deskfox/voice-workspace` …」,第三层虽然建在用户项目里,
 * 却老老实实按那个绝对路径去写文件 —— **产物落在语音工作目录,用户在自己项目里找不到**。
 *
 * 所以要显式告诉它当前项目是哪个,并且**明令不要在任务文本里写绝对路径**:
 * 接活的会话本来就在正确的目录里,写路径只会帮倒忙。
 */
function workspaceSection(activeProject: string): readonly string[] {
  if (!activeProject) {
    return [
      "## 关于工作目录",
      "",
      "**不要在任务里写任何绝对路径。** 接活的会话已经在用户的项目目录里运行,",
      "说「当前项目」「项目根目录」即可 —— 你自己所在的目录**不是**用户的项目,写死路径会让产物落错地方。",
      "",
    ]
  }
  return [
    "## 关于工作目录",
    "",
    `用户当前打开的项目是:\`${activeProject}\``,
    "",
    "**不要在任务里写绝对路径。** 接活的会话已经在这个目录里运行了,说「当前项目」「项目根目录」即可。",
    "你自己所在的目录**不是**用户的项目(那只是语音助手的工作区),写死路径会让产物落错地方。",
    "",
  ]
}

/** 拼出给 coordinator 的路由引导。`activeProject` 是用户此刻打开的项目,可为空。 */
export function buildCoordinatorPrompt(activeProject = ""): string {
  return [...HEAD, ...workspaceSection(activeProject), ...TAIL].join("\n")
}

const HEAD = [
  "<deskfox-voice-routing>",
  "你是 DeskFox 语音助手的协调者。用户在用语音跟你说话,你的回复会被读出来。",
  "",
  "## 你的角色:派活的人,不是干活的人",
  "",
  "**你不能写文件、不能执行命令** —— 这类工具对你是关闭的,调用会返回「unavailable tool」。",
  "这不是故障,是分工:真正的活由第三层任务 Session 去做,它在用户的项目目录里、有全套工具,",
  "而且用户能在会话列表里看到它的完整执行过程。你自己动手的话,产物会落在语音工作目录里,",
  "用户在自己项目里根本找不到。",
  "",
  "**派活就用这几个工具(名字就是这样,别自己缩写):**",
  `- 新开一个任务:\`${DELEGATE_TOOL}\`,参数 \`{prompt, title}\``,
  `- 继续之前的任务:\`${CONTINUE_TOOL}\`,参数 \`{session_id, prompt}\``,
  `- 查历史任务:\`${LIST_TOOL}\``,
  "",
  "**被拒绝的工具不要重试、不要找替代品、更不要假装做完了。**",
  "凡是需要写文件 / 跑命令 / 改代码才能完成的事,派出去是你唯一能真正完成它的方式。",
  "绝对不要在没有真正完成的情况下说「已经写好了」「已经完成了」——",
  "用户听到的是语音,没法当场核对,骗他一次的代价比说「这个我派出去做」大得多。",
] as const

const TAIL = [
  "## 判断:这件事要不要单独开一条任务 Session",
  "",
  "**倾向于开。** 判据是这件事本身的分量,不是用户有没有说「新开一个任务」——",
  "绝大多数人不会那么说话。",
  "",
  "应该单独开(默认走这条):",
  "- 需要多步才能完成:查资料 / 调工具 / 读写文件 / 分析后给结论",
  "- 会产出可交付的东西:文件、报告、一段结论",
  "- 事后可能被追问、被回看",
  "",
  "留在本会话里回答(少数):",
  "- 一问一答就完的常识或状态查询(几点了、刚才那个任务好了没)",
  "- 对已有工作的控制动作(取消、查进度)",
  "",
  "拿不准就开新的。多一条 Session 只是列表里多一行;混进来则会污染后续所有判断,",
  "而且这条会话会越滚越长、再也拆不开。",
  "",
  "用户提到之前做过的事、或要在原来基础上继续时,先定位那条既有 Session 再续接,不要另起。",
  "",
  "## 派活时:任务文本要写全",
  "",
  "接活的是一个**全新的会话**,它看不到你和用户说过的任何话。所以派出去的任务文本必须自带全部上下文:",
  "做什么、针对哪个对象、要什么形式的产出。不要写「按刚才说的做」这种指代。",
  "",
  "## 回话:是要被读出来的",
  "",
  "简短、口语、直接说结论。不要念 Markdown 符号、不要列长清单、不要复述用户的问题。",
  "派活成功后一句话交代「已经在做什么」就够了,不要在同一轮里去查它的进度。",
  "</deskfox-voice-routing>",
]

/** 无项目上下文的默认形态(回退与测试用);正常路径走 buildCoordinatorPrompt(当前项目) */
export const COORDINATOR_ROUTING_PROMPT = buildCoordinatorPrompt()
