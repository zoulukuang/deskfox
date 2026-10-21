feat-id: mac-release-readiness
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# Electron 维护更新：提交前复核

变更：`packages/desktop/package.json` 固定 Electron 42.3.3→42.11.15，`bun.lock` 同步对应解析。仍在同一 42 主版本，不改应用身份、数据库迁移基线或加密策略。官方相关修复：[safeStorage 惰性初始化，42.4.1 回补](https://releases.electronjs.org/pr/50419)、[42.11.15 维护修复](https://releases.electronjs.org/release/v42.11.15)。

## wrapper 不可替代的原因

弹窗触发点位于 Electron 内置 safeStorage/Chromium 原生实现，业务代码没有主动调用 safeStorage。外层 wrapper 无法替换已编译原生实现。只在打包命令指定另一运行时会让开发、测试、分发使用不同版本；关闭加密、重置系统钥匙串或屏蔽系统错误均不能作为修复。必须更新开发依赖和冻结锁文件，保证同一版本可重现安装，因此 `bun.lock` 的 R4 override 无法绕开。

## 风险与范围

- 运行框架更新会影响启动、Chromium 渲染、原生模块、utilityProcess 和 updater，需要重做 native 验收、签名、公证；旧框架候选不能直接发布。
- 锁文件最终变更为 7 行新增、17 行删除，限定 Electron 包、其替换的解压依赖及受其移除影响的依赖布局。剔除了包管理器生成的数千行 registry URL 重写；没有批量升级其他依赖。
- 桌面依赖两平台共用；本轮只发布 macOS，已经上线的 Windows 二进制不受影响。未来 Windows 构建将使用新 Electron，下一次 Windows 发布必须按其平台流程验证。
- 不申请新系统权限、不读写钥匙串密钥、不重建默认钥匙串。Intel 真机性能缺口按本轮用户明确授权保留记录并豁免发布阻断，不能写作测试通过。

## 已验证及发布前剩余检查

冻结安装通过（2606 installs，no changes）；完整 pre-push 退出 0，含 desktop 176、app 1195+44 等既有测试；新运行时最小程序在正常 HOME 与合成 HOME 均正常退出，旧运行时同一合成 HOME 对照残留；新 local 真实窗口已启动并完成合成会话完整回复，未出现钥匙串弹窗。日志 `logs/mac-keychain-20261021/`。

提交后/发布前继续完成私有旧库冷启动、原生混合拖放、后台恢复、真实 MacUpdater、双架构签名和公证、分发文件哈希及网站/更新源回读；未完成不得声明发布成功。无需通过修改产品代码复制上游修复。

回退：只回退运行时依赖及锁文件的本笔提交，重新构建旧运行框架；不能将旧候选当作已解决钥匙串问题的版本发布。受保护文件是 `bun.lock`，提交需按 CLAUDE.md R4 记录 override 理由，并在用户复核确认后进行。

2026-10-21 用户已明确回复“确认提交并继续发布”。本笔受保护锁文件改动已获 R4 二次确认，按规范在提交信息标明 override，仅为该文件跳过 pre-commit 黑名单拒绝；冻结安装、完整 pre-push、diff 检查已经执行并通过。
