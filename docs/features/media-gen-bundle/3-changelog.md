feat-id: media-gen-bundle
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog · media-gen 打包进安装包

## 改动概要

media-gen 从"靠开发仓绝对路径加载"升级为"软件内置部分"(同飞书机制):打进安装包 → 装到 `{app}\plugin\media-gen` → 开机 setup hook 自动注入 user opencode 配置。用户装完连 Alibaba (China) 填 key 即自动可用,零手动配。

## commit

`b977f4130` feat(media-gen): 创作插件打包进安装包,装完即用(同飞书机制)[feat: media-gen-bundle]

## 影响范围

**新增(fork-only)**:
- `packages/branding/plugin/media-gen/package.json`(bundled 包定义)+ `.gitignore`(dist/)
- `packages/branding/scripts/build-media-gen-plugin.{ps1,sh}`(复用 media-gen build.ts 出 dist → 摆进 branding/plugin/media-gen)

**改(均 FORK / fork-only 文件)**:
- `packages/desktop/src-tauri/tauri.conf.json`:resources + media-gen 两行(JSON 无注释,FORK 意图见 commit)
- `packages/branding/installer/DeskFox.iss`:[Files] + media-gen 两行
- `packages/desktop/src-tauri/src/feishu_plugin_install.rs`:通用化 `resolve_plugin_dir(dir_name)` + `inject_plugin` 末两段自动推标识(签名不变)+ 抽 `ensure_bundled_plugin_in_config` + 新增 `ensure_media_gen_plugin_in_config`
- `packages/desktop/src-tauri/src/lib.rs`:setup 调用 `ensure_media_gen_plugin_in_config`
- `packages/branding/scripts/build-deskfox.{ps1,sh}`:加 0.6 打包步 + media-gen 条目清理;**顺带修编码 bug**(清理块 Get-Content/Set-Content → .NET UTF-8 无 BOM,见 2-plan 踩坑)

## 测试 / 回归

- 单测:`feishu_plugin_install` 加 `media_gen_and_feishu_coexist_without_cross_removal`(两插件靠末两段标识区分 + 互不误删 + 幂等)。Rust 编译通过(lib 单测因 Win 缺运行时 DLL 跑不起来 = 既有环境限制,非本改动)。
- 真机端到端:build→清理(opencode.jsonc 仍合法 UTF-8 首字节 0x7B)→启动 setup hook 注入 target/release 双插件→media-gen `/healthz` ok + `/models` 8模型7能力→文生图生成落项目根 creations/。
- 全仓 typecheck 17/17;media-gen 28 单测 0 fail。
- 免安装 raw exe 验证(user 要求免安装测试包);.iss 安装路径按飞书镜像,真发布时一并验。

## 回退

revert b977f4130 即回"开发仓路径加载";opencode.jsonc 里 media-gen 条目由下次启动 setup hook 重建。

## 备注

跟 minimax(第二供应商)无关 —— 那是通用引擎架构的事,见 `OPENCODE-PLAN/需求池/多模态创作-后续路线-通用引擎与自助配置.md`。
