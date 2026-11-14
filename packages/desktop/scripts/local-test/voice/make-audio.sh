#!/usr/bin/env bash
# [fork-only] REQ-102 语音派活 — 合成中文测试音频 [feat: voice-dispatch-minimal] 2026-08-21
#
# 为什么要它:语音链路的验收不接受 mock 文本 —— 必须有真音频过 ASR + 服务端 VAD,
# 否则验的只是"文本进文本出",链路里最容易坏的那一段(转写截断、转向检测过激、打断时延)
# 全被跳过。macOS 自带 `say` 合成 + `afconvert` 转码,零外部依赖、可无人值守重复跑。
#
# 输出:PCM16 / 16kHz / 单声道裸流(Gateway `/api/health` 的 realtimeInputSampleRate = 16000)。
#
# ⚠️ 音色:`say -v Tingting` 是本机唯一可用的中文音色;`Eddy` 等 zh_CN 音色未安装时
#    只会产出 0.016s 的空音频(spike 实测踩过),所以这里写死 Tingting 并做时长校验。
#
# 用法:
#   bash make-audio.sh "你好千问" wake.pcm
#   bash make-audio.sh "帮我在当前项目里新建 patch.txt,写一行 hello" task.pcm
set -euo pipefail

TEXT="${1:?用法: make-audio.sh <中文文本> <输出.pcm> [音色]}"
OUT="${2:?用法: make-audio.sh <中文文本> <输出.pcm> [音色]}"
VOICE="${3:-Tingting}"

command -v say >/dev/null || { echo "❌ 没有 say(本脚本仅 macOS)" >&2; exit 3; }
command -v afconvert >/dev/null || { echo "❌ 没有 afconvert(本脚本仅 macOS)" >&2; exit 3; }

if ! say -v "?" | awk '{print $1}' | grep -qx "$VOICE"; then
  echo "❌ 音色 $VOICE 未安装。已装的中文音色:" >&2
  say -v "?" | grep -i "zh_" >&2 || echo "  (一个都没有 —— 去 系统设置 → 辅助功能 → 朗读内容 装一个)" >&2
  exit 3
fi

TMP_AIFF="$(mktemp -t voice-src).aiff"
trap 'rm -f "$TMP_AIFF"' EXIT

say -v "$VOICE" -o "$TMP_AIFF" "$TEXT"
# LEI16 = little-endian PCM16;-c 1 单声道;-r 16000 采样率;-f caff 后取裸数据
afconvert -f WAVE -d LEI16@16000 -c 1 "$TMP_AIFF" "${OUT}.wav"
# 去掉 44 字节 WAV 头 → 裸 PCM(Gateway 吃的是裸流)
tail -c +45 "${OUT}.wav" > "$OUT"
rm -f "${OUT}.wav"

BYTES=$(wc -c < "$OUT" | tr -d ' ')
# 16000 采样/秒 × 2 字节 = 32000 字节/秒
MS=$(( BYTES * 1000 / 32000 ))
if [ "$MS" -lt 300 ]; then
  echo "❌ 只合成出 ${MS}ms(${BYTES} 字节)—— 音色 $VOICE 大概率对中文无效,换一个。" >&2
  exit 4
fi

echo "✅ $OUT — ${MS}ms / ${BYTES} 字节 / PCM16 16kHz 单声道 / 音色 $VOICE"
echo "   文本:$TEXT"
