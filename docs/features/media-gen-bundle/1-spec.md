feat-id: media-gen-bundle
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 1-spec · media-gen 打包进安装包(media-gen-bundle)

## 背景

`media-creation-mode` 落地后,media-gen 插件仍靠 user 个人 `~/.config/opencode/opencode.jsonc` 里一条**写死的开发仓绝对路径**加载(`file:///D:/.../packages/media-gen/dist/plugin.js`)。后果:① 只在开发机有效,移动/删开发仓即失效 ② 发给别人完全没有创作功能。2026-05-27 user 拍板:**让它和飞书一样打包进安装包,作为软件内置部分**。

## 验收标准

- media-gen 作为 resource ship 进安装包(Win Inno Setup + Tauri resources),装到 `{app}\plugin\media-gen`。
- DeskFox 启动时自动把"安装目录里的 media-gen 路径"注入 user opencode 配置(同 feishu setup hook,idempotent + 失效自愈)。
- 用户装新包 + 在"连接提供商"连 **Alibaba (China)** 填 key → 创作能力**自动可用,零手动配**(阿里 8 模型内置 catalog,配 key 即亮)。
- 不破坏飞书既有注入;开发机来回 build 不累积重复条目。

## 架构选型

镜像飞书 `feishu-bridge-ship-packaging` 全套:build 产出 → Tauri resources → .iss [Files] → `feishu_plugin_install.rs` runtime 注入。注入逻辑通用化(参数化 dir_name)使飞书 + media-gen 共用,不复制。
