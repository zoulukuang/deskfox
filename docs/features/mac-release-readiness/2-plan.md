feat-id: mac-release-readiness
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 执行计划

1. 主目录 fast-forward 至 65b23fca0b，比较 diff 确认用户改动逐字节保留；复用干净工作树创建 mac-release-ready。
2. 对齐 Windows 的候选隔离构建能力，Mac 参数采用 --keep-running / --output-directory；在进程操作前校验输出目录，复用现行签名打包链。
3. 独立运行真实 MacUpdater 检查，再执行 Mac 完整验收；原有失败/平台边界不以旧记录代替本轮结果。
4. 候选版本与制品保留在本地；收口后给出准确待办与可发布条件。
