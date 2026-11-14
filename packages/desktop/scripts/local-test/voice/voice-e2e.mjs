// [fork-only] REQ-102 语音派活 — 端到端:唤醒 → 派活 → 后台执行 → 播报 [feat: voice-dispatch-minimal] 2026-08-21
//
// 这是 R8 用例 T15(真实触发)的**无人值守版**:真音频过 ASR + 服务端 VAD,不是 mock 文本。
// T15 本身仍要人对着真麦克风说一遍 —— 本脚本负责把"每次改完能不能自动回归"这件事撑住。
//
// 前置:Gateway 已起(`qwenaudio gateway status`),且音频已合成(make-audio.sh)。
//
//   bash make-audio.sh "你好千问" /tmp/v-wake.pcm
//   bash make-audio.sh "帮我在当前项目里新建 patch.txt,写一行 hello from voice" /tmp/v-task.pcm
//   bun voice-e2e.mjs --wake /tmp/v-wake.pcm --task /tmp/v-task.pcm [--expect-file <路径>]
//
// --expect-file 给了就顺带做落盘校验(权限真给到了没:REQ-102 §3.8 那条「工具静默跳过 + 假报成功」
// 的触发条件就是权限没给到,只看 task.completed 会被骗过去)。
import { existsSync, readFileSync } from "node:fs"
import { DEFAULT_GATEWAY, GatewayClient, report, sleep } from "./gateway-client.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(k)
  return i >= 0 ? argv[i + 1] : d
}

const wakePcm = arg("--wake")
const taskPcm = arg("--task")
const gateway = arg("--gateway", DEFAULT_GATEWAY)
const expectFile = arg("--expect-file")
const taskTimeout = Number(arg("--task-timeout", "180000"))

if (!wakePcm || !taskPcm) {
  console.error("用法: bun voice-e2e.mjs --wake <唤醒.pcm> --task <派活.pcm> [--expect-file <落盘校验路径>]")
  process.exit(3)
}
for (const p of [wakePcm, taskPcm]) {
  if (!existsSync(p)) {
    console.error(`❌ 音频不存在:${p}(先跑 make-audio.sh)`)
    process.exit(3)
  }
}

const c = new GatewayClient(gateway)
console.log(`连接 ${gateway} …`)
try {
  await c.connect()
} catch (e) {
  console.error(`❌ ${e?.message ?? e}`)
  console.error("   Gateway 没起就先 `qwenaudio gateway start --backend opencode`(参数固化见 S2)")
  process.exit(3)
}
console.log("已连接,开始灌音频(按真实时速率):\n")

// ① 唤醒
await c.feedPcm(wakePcm, { label: "唤醒词" })
const woke = await c.waitFor((e) => e.type === "audio.delta" || e.type === "transcript.final", 20000)

// 给模型把唤醒应答说完的余量,再派活 —— 紧接着灌会被当成打断
await sleep(2000)

// ② 派活
await c.feedPcm(taskPcm, { label: "派活口令" })

// ③ 等后台任务落地
const accepted = await c.waitFor((e) => e.type === "task.accepted", 60000)
const completed = accepted ? await c.waitFor((e) => e.type === "task.completed", taskTimeout) : null

// 收尾:再等一小会儿,把结果播报(origin=announcement)收进来
await sleep(3000)
c.close()

const transcripts = c.all("transcript.final").map((e) => e.evt.transcript ?? e.evt.text ?? "")
const speech = c.all("response.started").map((e) => e.evt.origin)

const checks = [
  { name: "Gateway 建连", ok: true, detail: gateway },
  { name: "唤醒有反应(出声或出转写)", ok: !!woke, detail: woke ? `${woke.at}ms` : "20s 内无反应" },
  {
    name: "口令被转写",
    ok: transcripts.length > 0,
    detail: transcripts.length ? JSON.stringify(transcripts[transcripts.length - 1]) : "无 transcript.final",
  },
  {
    name: "派活成功(task.accepted)",
    ok: !!accepted,
    detail: accepted ? `${accepted.at}ms objective=${JSON.stringify(accepted.evt.objective ?? "")}` : "60s 内未派活",
  },
  {
    name: "任务完成(task.completed)",
    ok: !!completed,
    detail: completed ? `${completed.at}ms result=${JSON.stringify(String(completed.evt.result ?? "").slice(0, 80))}` : "超时",
  },
  {
    name: "有语音播报(audio.delta > 0)",
    ok: c.count("audio.delta") > 0,
    detail: `${c.count("audio.delta")} 帧;response.started origin=[${speech.join(",")}]`,
  },
]

if (expectFile) {
  const ok = existsSync(expectFile)
  checks.push({
    name: `落盘校验 ${expectFile}`,
    ok,
    // 只有 task.completed 而文件不存在 = 「工具静默跳过 + 假报成功」(REQ-102 D10),权限没给到
    detail: ok
      ? JSON.stringify(readFileSync(expectFile, "utf-8").slice(0, 60))
      : "文件不存在 —— 若 task.completed 却没落盘,就是 D10 那条『假报成功』,查 permission 模式",
  })
}

process.exit(report("voice-e2e:唤醒 → 派活 → 执行 → 播报", checks))
