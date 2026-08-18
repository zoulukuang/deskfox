feat-id: voice-preclear-batch
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 语音派活前置清障批 — 3-changelog

> 待施工(spec 已收口锁版,2026-08-18)。开发中每批 commit 后按规范填:实际改动 / commit hash /
> 行数 / 影响范围 / 回归测试 / 回退方法。

## 交付记录

(待填,按 2-plan 批次:S3 → S4a/S4b → S1×3 → S2×2-3 → S5)

## 已知边界(预留,交付时补实录)

- **(S1 / D2 拍板接受)** updater `allowDowngrade=true` 下,用户降级后自家新 db 会被启动期检测判超前并
  隔离挪走(`opencode.db.incompatible-<ts>`,保留可手动恢复)—— 把「静默永久坏」换成「显式隔离」,
  设计内行为,非 bug。

## 回退方法

(待填,每批一笔独立 commit,P4 可逆)
