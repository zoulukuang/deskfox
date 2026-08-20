// [fork-only] REQ-102 语音派活 — 打断(barge-in)与并发派活 [feat: voice-dispatch-minimal] 2026-08-21
//
// 两件 voice-e2e 不管的事:
//   ① **打断**:模型正在长篇作答时插话,服务端应尽快下发 `playback.clear`(命令客户端清空播放
//      缓冲)。spike 实测 4/4 触发、0.9~1.4s;这里把它变成可回归的数字。
//   ② **并发派活**:REQ-102 D9 的遗留半项 —— 派两件真正"重"且不相干的活,验它们拿到**不同
//      taskId**、且能分别问进度。spike 里两个 task 没有时间重叠(A 只跑 7.9s),真并行仍未实证,
//      本脚本把两次派活时间戳打出来,重叠与否一目了然。
//
//   bash make-audio.sh "你好千问" /tmp/v-wake.pcm
//   bash make-audio.sh "给我讲讲人工智能的发展历史,尽量详细一些" /tmp/v-long.pcm
//   bash make-audio.sh "停" /tmp/v-stop.pcm
//   bash make-audio.sh "帮我统计一下用户主目录下有多少个子目录" /tmp/v-taskA.pcm
//   bash make-audio.sh "帮我看看当前项目里有多少个 markdown 文件" /tmp/v-taskB.pcm
//   bun voice-e2e2.mjs --wake /tmp/v-wake.pcm --long /tmp/v-long.pcm --stop /tmp/v-stop.pcm \
//                      --taskA /tmp/v-taskA.pcm --taskB /tmp/v-taskB.pcm
import { existsSync } from "node:fs"
import { DEFAULT_GATEWAY, GatewayClient, report, sleep } from "./gateway-client.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(k)
  return i >= 0 ? argv[i + 1] : d
}

const wake = arg("--wake")
const long = arg("--long")
const stop = arg("--stop")
const taskA = arg("--taskA")
const taskB = arg("--taskB")
const gateway = arg("--gateway", DEFAULT_GATEWAY)
/** 打断用语音(真实路径)还是直接发 interrupt 帧(协议路径)。默认语音,更接近真人。 */
const bargeMode = arg("--barge", "voice")

for (const [k, v] of [["--wake", wake], ["--long", long], ["--taskA", taskA], ["--taskB", taskB]]) {
  if (!v || !existsSync(v)) {
    console.error(`❌ 缺少或找不到 ${k}(先跑 make-audio.sh);用法见文件头注释`)
    process.exit(3)
  }
}
if (bargeMode === "voice" && (!stop || !existsSync(stop))) {
  console.error("❌ --barge voice 需要 --stop <打断语音.pcm>;或改用 --barge frame")
  process.exit(3)
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
console.log("已连接\n")

// ───────── ① 打断 ─────────
console.log("── ① 打断(barge-in)──")
await c.feedPcm(wake, { label: "唤醒词" })
await sleep(2000)
await c.feedPcm(long, { label: "长问题" })

// 等它真的开口(有音频帧出来)再插话,否则测的是"没在说话时打断",没有意义
const speaking = await c.waitFor((e) => e.type === "audio.delta", 30000)
await sleep(1500)

const bargeAt = c.elapsed
if (bargeMode === "voice") {
  await c.feedPcm(stop, { label: "插话「停」" })
} else {
  console.log(`  ▶ 发 interrupt 帧`)
  c.interrupt()
}
const cleared = await c.waitFor((e) => e.type === "playback.clear" && e.at > bargeAt, 15000)
const clearLatency = cleared ? cleared.at - bargeAt : null

await sleep(2000)

// ───────── ② 并发派活 ─────────
console.log("\n── ② 并发派活 ──")
const beforeTasks = c.count("task.accepted")
await c.feedPcm(taskA, { label: "任务 A" })
const acceptedA = await c.waitFor((e) => e.type === "task.accepted", 60000)
// 不等 A 完成就派 B —— 要的就是重叠
await sleep(500)
await c.feedPcm(taskB, { label: "任务 B" })
const acceptedB = await c.waitFor(
  (e) => e.type === "task.accepted" && e.taskId && e.taskId !== acceptedA?.evt?.taskId,
  60000,
)

const completions = []
const deadline = Date.now() + 180000
while (completions.length < 2 && Date.now() < deadline) {
  const done = await c.waitFor((e) => e.type === "task.completed" && !completions.includes(e.taskId), 30000)
  if (!done) break
  completions.push(done.evt.taskId)
}

c.close()

const idA = acceptedA?.evt?.taskId ?? null
const idB = acceptedB?.evt?.taskId ?? null
const overlap =
  acceptedA && acceptedB && completions.length
    ? `A 派于 ${acceptedA.at}ms / B 派于 ${acceptedB.at}ms;完成 ${completions.length} 个`
    : "数据不足"

const checks = [
  { name: "模型确实开口了(打断前提成立)", ok: !!speaking, detail: speaking ? `${speaking.at}ms 起有音频` : "30s 内没出声" },
  {
    name: "打断触发 playback.clear",
    ok: !!cleared,
    detail: cleared ? `${clearLatency}ms(spike 基线 0.9~1.4s)` : "15s 内未下发",
  },
  {
    name: "打断时延 ≤ 2s",
    ok: clearLatency !== null && clearLatency <= 2000,
    detail: clearLatency === null ? "无数据" : `${clearLatency}ms`,
  },
  { name: "任务 A 派出", ok: !!acceptedA, detail: idA ?? "未派活" },
  { name: "任务 B 派出且 taskId 不同", ok: !!acceptedB && idA !== idB, detail: idB ?? "未派活/同 id" },
  {
    name: "两个任务都完成",
    ok: completions.length >= 2,
    detail: `${completions.length}/2 — ${overlap}`,
  },
  {
    name: "本轮新增派活数 ≥ 2",
    ok: c.count("task.accepted") - beforeTasks >= 2,
    detail: `${c.count("task.accepted") - beforeTasks}`,
  },
]

process.exit(report("voice-e2e2:打断 + 并发派活", checks))
