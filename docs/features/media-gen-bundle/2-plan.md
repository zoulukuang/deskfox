feat-id: media-gen-bundle
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan · media-gen-bundle 实施计划 + 决策轨迹

## 镜像飞书的 5 个环节

| 环节 | 飞书 | media-gen 照做 |
|---|---|---|
| build 产出 | build-feishu-plugin.{ps1,sh} → branding/plugin/feishu-bridge/ | 新 build-media-gen-plugin.{ps1,sh},复用 media-gen build.ts 出 dist → branding/plugin/media-gen/(dist gitignore,package.json 提交) |
| 进包 | tauri.conf.json resources | + media-gen 两行 resource |
| 装到安装目录 | DeskFox.iss [Files] | + media-gen 两行 |
| 写进 user 配置 | feishu_plugin_install.rs setup hook | 通用化 + 新增 ensure_media_gen_plugin_in_config;lib.rs setup 调用 |
| build 串联 | build-deskfox 调飞书 build + 清重复 | + 0.6 media-gen build 步 + media-gen 条目清理 |

## 关键实现决策

- **注入逻辑通用化(最小改动)**:`resolve_plugin_dir` 参数化 `dir_name`;`inject_plugin` 签名不变,从 `plugin_dir` 末两段(如 `plugin/media-gen`)自动推标识做去重 retain → **测试零改动**;抽 `ensure_bundled_plugin_in_config(app, dir_name)`,feishu / media-gen 各自调用(media-gen 无 imbot)。
- **复用 media-gen build.ts**(已验证产物 433KB)而非重写 bun build 命令,降风险。
- **dev 路径迁移**:build-deskfox 清理块去掉旧 `packages/media-gen` 开发仓条目,setup hook 注入安装/资源路径单条(同飞书,只在开发机生效)。

## 踩坑(实测沉淀)

- **PS5.1 编码坑(顺手修)**:build-deskfox 清理块原用 `Get-Content/Set-Content`(默认 ANSI/GBK),改含中文的 opencode.jsonc 会写成非 UTF-8 → Rust setup hook serde 读报 `stream did not contain valid UTF-8` → 三注入(feishu+media-gen+imbot)全废。飞书清理潜伏此 bug(count>1 罕触发),media-gen 清理 count>=1 必现。改 `.NET ReadAllText / WriteAllText(UTF8Encoding($false))`(无 BOM,对齐 Rust serde 写出)。详见记忆 `reference_ps_config_edit_utf8_gotcha`。
- raw exe 的 `resource_dir()` = target/release,Tauri --no-bundle 仍把 resources copy 到 target/release/plugin/media-gen → setup hook 注入 target/release 路径,免安装包也能验注入。

## 验证

build→清理(配置仍合法 UTF-8 首字节 0x7B)→启动 setup hook 注入 target/release 双插件→media-gen /healthz ok + /models 8模型7能力→文生图端到端生成落项目根 creations/ —— 全通。
