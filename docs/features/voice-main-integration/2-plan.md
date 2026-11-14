feat-id: voice-main-integration
status: in-progress
related: ./1-spec.md ./3-changelog.md

# 实施计划

1. 从更新后的 main 建集成分支，保留原语音分支，验证既有 bundle。
2. 合并原分支，解决文档冲突，保留两侧历史。
3. 先跑语音测试并核对当前后端接口；集成缺陷先补复现测试再修复。
4. 跑完整开发闸，补齐分支回执与真机验收清单。

无需引入设置 UI、重写语音架构或删除旧链路。测试使用临时目录/独立进程，不连接正式数据与付费模型。

## 集成发现与处理(2026-11-14)

- merge 仅 `docs/features/INDEX.md` 与根改动日志冲突，两侧条目均保留；main 的较新代码自动合并，无需重写原语音实现。
- 本机 Bun 1.3.14 的裸路径筛选跑法下，wrapper 子进程输出为空，6 条失败，已安装的 qwen 快照也被误判未安装。同一测试显式 `./` 路径或绝对路径通过。pre-push 的 desktop 命令改为显式路径；不删除测试、不放松断言。记录的是本机可重复对照，不推断所有环境都有此行为。
- 原集成测试继承整个宿主 env，而且取消测试先睡 1 秒；隔离后无模型的任务早已结束，期望 cancelled 实际 end_turn。改成白名单 env + 临时 HOME/XDG + 仅 loopback 的测试模型；等模型请求确实在途再取消。真实 sidecar 和真实 ACP 桥均保留。
- 完成事件测试从「任意非空文字(错误也算)」加强为精确包含测试模型回复；增加真实 HTTP 会话模型/metadata 保真与排除语音会话的模型跟随验证。项目状态文件同步写入，避免测试自行制造未等待写盘的竞态。
- 产品边界保持原样：最近使用模型代理、项目 5 秒轮询、主动关闭取消任务、崩溃后后端任务独立、旧链路回退开关。设置 UI 只保留原有 spec，未开发。

## local 隔离补丁

启动前核查发现 `app.setAsDefaultProtocolClient("opencode")` 无条件执行，会让本地版抢正式版的 URL 默认处理权。抽到 fork-only `registerDeskfoxProtocol`，只给打包的发布渠道注册；index.ts 一处调用替换。先按原行为复现 local/未打包两条失败，再加保护，5 条通过；发布三档保持原行为。本地包不抢协议是「不影响正式版」的必要修复，未改变语音产品设计。

## local 构建与运行

- 候选 `b538afd409` 放独立 detached worktree，锁文件安装后直接跑 desktop 构建与 electron-builder `--dir --publish never`，不调用会结束正式版进程的发版包装脚本。未签名/公证/上传。
- 专用启动器设置 HOME、CFFIXED_USER_HOME、XDG、源码桥路径，私有 `.profile` 保持 shell-env 探测后的隔离环境；qwen-audio-agent 1.11.0 独立副本避免启动时品牌注入改到全局安装。只复制唤醒模型，不迁移正式版凭据。
- 曾尝试额外 sandbox-exec 文件保护；macOS 拒绝 Electron 子进程再次初始化沙箱，窗口未打开。结束的仅该 local PID 50409，移除额外包装；保留 Electron 原有沙箱，第二次启动成功。失败日志保留，不使用 `--no-sandbox`。
- 通过 lsof 与实际文件核查 HOME/XDG/userData/数据库隔离。此方案是测试运行目录隔离，不是限制模型访问所有宿主文件的安全沙箱；人工任务限定在两个测试项目。
- local 使用 `OPENCODE_PURE=1` 关闭静态业务插件，避免飞书等服务与正式版冲突；本轮验证语音核心，不覆盖这些插件。Mac 真机听说体验、长任务和并发播报仍待用户配合。
