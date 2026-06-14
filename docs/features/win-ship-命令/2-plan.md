feat-id: win-ship-命令
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 实施计划与决策轨迹

## 步骤映射

| SOP 步骤 | 实现位置 |
|---|---|
| 0-3, 5-10 | user 级 `~/.claude/commands/ship.md`(既有,本机 gitignored)|
| **3.5 填实台账**(新增) | `ship.md` 步骤 3 与 4 之间插入;内容来源 = code-review 摘要 + `git log <上个 ship tag>..HEAD` |
| SOP 知识固化 | 本 feat `docs/features/win-ship-命令/`(入仓)|

## 决策轨迹

- **起点(2026-06-03)**:清理 main 分支时发现 ① Win 6.1.1 台账缺失(ship 流程台账未回流,已手动补 commit 50f1c5ce3)② Win/Mac 6.2.1 台账空占位。
- **方向几经收敛**:
  1. 初判「Win ship 不回流 main」→ 核对发现 ship.md 步骤 8 已于 2026-06-02 加自动回流,6.1.1 是更早遗留。**核心缺口已修**。
  2. 转向「入库 ship.md 统一双端」→ 撞两坎:`.gitignore` 忽略 `.claude/` + ship.md 平台专属会与 Mac 撞车。
  3. 读 `macos-ship-命令/3-changelog` 发现 Mac **有意决定 command 不入仓**(避冲突),且 Win 端**拿不到 Mac 完整 SOP** 无法验证跨平台合并。
  4. **最终(user 拍板)**:对齐既定架构 —— command 各端本机,**只补 Win 的 SOP 入仓文档 + 台账填实**,不强行合并 command。
- **不做**:跨平台合并 command(留双端在线协作时做);改 Mac 段(无法在 Win 验证)。

## 后续(backlog 候选)

- **Mac 侧台账填实对齐**:把本 feat 给 Win 加的「步骤 3.5 填实台账」同样加到 Mac `ship.md`(需 Mac 端操作)。
- **双端 ship command 跨平台统一**:若将来要单一 `/ship` 跨平台,需双端在线协作合并 `.ps1`/`.sh` 两套并在各端验证。
