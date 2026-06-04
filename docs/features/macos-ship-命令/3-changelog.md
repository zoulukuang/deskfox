feat-id: macos-ship-命令
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

## 规模

Medium(skill SOP ~120 行 + 三文档)。纯编排层,0 改上游,0 R4。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `.claude/commands/ship.md` | 新增(**本机,gitignored,不入仓**) | macOS `/ship` skill SOP:完整模式 0-8 + resume 模式 + 公证门禁 + 隐私约束。 |
| `docs/features/macos-ship-命令/{1-spec,2-plan,3-changelog}.md` | 新增(入仓) | 设计 + 步骤映射 + 决策,可据此重建 skill。 |
| `docs/features/INDEX.md` / `改动日志.md` | 改 | 索引各一行。 |

## 关键设计(详见 1-spec)

- **不公证不推送**(3.5 硬门禁)+ **公证失败 `/ship resume` 续发**(应对苹果服务不稳)。
- **双轮验证前置**(不进 ship)+ **触发即授权一口气跑** + **code-review 高危才停**。
- skill 本机不入仓(避免与 Win `/ship` 冲突),SOP 知识入仓本 feat。

## 验证

- 步骤 3/3.5(打包+签名+公证+门禁)本 session 实测过:Tauri 自动签成功、公证撞苹果超时、`spctl=Unnotarized Developer ID`、命名 `DeskFox-2026.6.1.1_aarch64.dmg`。
- 步骤 4-8(真推送)靠 skill 逻辑 review + 复用 user 历史实战过的脚本;真推送待下次实际发版验证。
- skill grep 零硬编码隐私(身份/token 走 config.env + 环境变量)。

## 影响范围

- 无产品代码 / 运行时变化,纯发布工具链编排。
- 与 Win `/ship` 互不干扰(各端本地 skill)。

## commit

本笔 commit:`feat: macOS /ship 一键发版命令 [feat: macos-ship-命令]`(skill 本机 gitignored,仅 docs 入仓)

## 回退

删 `.claude/commands/ship.md`(本机)+ `git revert` docs。无运行时状态。

---

## Follow-up(2026-06-04):国内镜像 Gitee 附件 → 阿里云 OSS [feat: ship-oss-upload]

**起因**:.dmg 内嵌 LibreOffice 后已 **~274MB**,远超 Gitee 100MB 单文件上限 —— 原步骤 7b `mirror-asset-to-gitee.sh` 附件上传**已失效**。官网 `deskfox-site/update-version.ps1` 此前已把国内镜像从 Gitee release URL 迁到阿里云 CDN `dl.clawtray.com/<AssetName>`(Gitee 仅 fallback),本次让 ship 流程对齐这条链路。

**改造**:
- 新增 `packages/branding/scripts/upload-asset-to-oss.sh`(入仓,fork-only 新文件):自动定位/下载 ossutil(到 ExtSSD)→ `ossutil cp` 传到 `oss://downloadbot/<文件名>`(分片+断点续传,无 100MB 上限)→ HEAD 验证 `https://dl.clawtray.com/<文件名>` → 打印机器可解析 `OSS_DOWNLOAD_URL=`。凭据全走环境变量(`OSS_ACCESS_KEY_ID/SECRET/ENDPOINT/BUCKET/CDN_BASE`),**零硬编码**。
- ship skill 步骤 7 重写:7a 跑 OSS 上传取链接;7b Gitee release **正文嵌 CDN 下载链接,不再传附件**。步骤 10 报告 + 隐私段同步更新。
- OSS 凭据写入 `~/.deskfox-signing/config.env`(本机 gitignored,**不入仓**);凭据原始出处 `deskfox-site/deploy/alibaba-cdn.md`(该仓 `deploy/` 亦 gitignored)。
- `mirror-asset-to-gitee.sh` 保留不动(<100MB 包 / Win fallback 仍可用)。

**验证**:脚本 `bash -n` 语法通过 + `--help`/缺凭据报错路径自检通过;真上传(传 274MB 到生产 OSS)按 user 决策留到下次实际发版时跑。
