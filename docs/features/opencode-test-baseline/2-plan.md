feat-id: opencode-test-baseline
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

## 步骤

1. 分支 `feat/opencode-test-baseline`(off main `f04b7d5bb2`,gitee 镜像核过最新)✅
2. 干净 env(清代理 + en locale)后台跑 `cd packages/opencode && bun test`,raw log 落 scratchpad
3. 归一化:`grep '^(fail)' | sed 剥耗时 | sort` → `baseline-<sha>-mac-arm64.txt`,末尾附汇总四数
4. 逐条核对失败用例性质(fork 回归 vs 已知环境型假失败 vs 上游既存),写进 README.md
5. B1-B5 验收;3-changelog;commit(E6:先查 `git status` 确认 `bun.lock` 干净)
6. Win 段接力项写清楚(命令一致 + 与旧 19 条对比三栏 + REQ-048 hook 复验),留给 Windows 端

## 决策轨迹

- **Mac 也留基线而不只是"验证命令"**:升级后 Mac 同样要 diff,基线独立有价值(需求池 doc 定稿方案已写明)。
- **环境预处理写死进 README**:基线的可信度取决于可复现性;本机已知环境型假失败(Clash 代理拦 localhost / 中文 locale 快照 / fff-bun native 临时路径)必须在跑之前排除或在结果里标注性质,否则升级后 diff 会把环境噪声误判成 1.18 回归。
- **归一化剥耗时 + sort**:bun 每次输出顺序与耗时都不稳定,不剥则 diff 永远是全文变更。
- **【踩坑 2026-08-10】单轮全量 fail 集不稳定,方法学现场升级**:run1 = 16 fail(382s),run2 = 3 fail(266s),13 条差异全是 5000ms 冷启动/负载超时(httpapi 群 / workspace / agent / project-copy)。且「两轮交集」也不够:交集 3 条里 `agent > reference config does not create subagents` 用 `-t` 过滤单跑 ×3 全过(agent.test.ts 每轮换不同用例超时,交集撞上纯属高频 flaky)。最终以「全量 ×2 交集 + 过滤单跑 ×3 全败」为确定性判据 → 仅 2 条入基线正文。基线文件正文只放确定性失败,flaky 记 README 附录并明示「diff 时不作回归依据,先重跑再下结论」。
- **【排查记录】隔离批量跑(10 文件一起)仍 9 fail、逐文件单跑 6/10 文件仍有 fail 且数目与全量跑不一致** —— 说明「隔离跑全过」的旧 memory 结论对这批不成立,超时阈值 5s 对冷启动(每个测试文件独立进程起 instance)本来就紧。还排查过端口冲突假设(user 常开的正式版 DeskFox 是否占 4096 / mDNS 干扰):`lsof` 证伪,4096 无人占,DeskFox 只听 ephemeral 端口。
- **两条确定性失败都不修**(REQ-105 明确不做):测试文件 git 历史全是上游 commit、无 fork 触碰,初判非 fork 回归;升级后按 diff 复查。
