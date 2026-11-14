feat-id: brand-docs-refresh
status: done
related: ./3-changelog.md

# 品牌来源与托盘说明修正

执行电脑：笑南的电脑；工具：Codex；日期：2026-11-14。用户明确授权修正两处说明、提交后合入 main 并推送，再清理临时分支；不改图片或软件行为。

保留 DeskFoxWordmark 顶部来源注释：品牌正本已迁至运营仓，对应 SVG 确实存在。托盘 README 改为当前后台健康三态、Mac 模板图与 Windows/Linux 彩色图区分，注明两张输入基图、六张状态图、生成常量及构建生效流程；移除旧的四图重绘命令，明确历史飞书状态图片的用途。未执行图片生成、安装依赖或打包。

验证：逐项对照 gen-tray-icons.py、tray-status.ts 和 tray.ts；检查资源路径和历史四图字节一致性；移除 TSX 顶部注释后与 main 基线完全一致；除该注释外，差异仅含 Markdown。git diff --check 及提交守卫通过。按 docs-only 例外不运行产品测试，提交和合并信息注明。

提交按 `[feat: brand-docs-refresh]` 检索；本次用 --no-ff 合并保留边界。恢复旧说明可在新分支撤销本功能文档提交，按主干审批流程合入；不涉及图片、生成常量或用户数据。
