feat-id: release-2026.12.1
status: in-progress
related: ./3-changelog.md

# 2026.12.1 发布交接单(Mac + Windows)

> 交接人:Claude(代 owner 整理,2026-11-09)→ 接手人:笑南。
> 本单回答三个问题:发什么、已经验到哪、剩下你要做什么。做完请把本文件 status 改 done 并补 ship 台账。

## 一、发什么(内容边界)

**基线是 `ship-mac-prod-2026.11.2`**,不是 2026.12.0。12.0 的附件成本保护(REQ-142/143/144)、Electron 42.11.15、看门狗/钥匙串修复**全部不在**本版;它们留在历史和 `ship-*-2026.12.0` tag 里,待单独评审后再合回。

本版只带四项:

| 项 | 来源 | 说明 |
|---|---|---|
| REQ-148 双站分享(deskfox.cn / deskfox.ai) | 12.0 的 share-routing 5 笔 cherry-pick | 含 Windows 路径校验与七天备份脚本;服务端两站已部署,**无需重部署** |
| 配置型供应商断开后列表不刷新 | 新修复 `provider-disconnect-stale` | GetBot 属此类;根因与修法见该 feat 的 3-changelog |
| updater 禁止降级 | 12.0 的 `68397f2a0` 仅代码三文件 | Windows 12.0 已带,12.1 不倒退 |
| 干净工作树 icon.icns 生成修复 | 新 `fix/mac-icon-clean-tree` | 全新 clone 打 prod 包第 2 步必失败,已修 |

版本号:macOS `2026.11.2 → 2026.12.1`,Windows `2026.11.0 → 2026.12.1`(两端同号;跳过 12.0 因其已发布且 updater 禁降级)。

**代码位置**:本地 `main` 合并提交链 `06889891f`(发布内容)→ `afee4b9c9`(图标修复)→ 本交接单提交;同一内容已推到远端分支 **`release/2026.12.1`**(main 本身未推,见第四节)。

## 二、已经验到哪

| 项 | 结果 |
|---|---|
| 完整 `.husky/pre-push` 闸(29 包 typecheck + 六包单测) | 全绿:app 1197+41 / media-gen 140 / 飞书 792 / branding 82(8 Win skip)/ desktop 172 / session-ui 125 |
| opencode 分享专项 / core 迁移 / app public-share / enterprise 分享服务 | 35 pass 2 live-skip / 1 pass / 28 pass / 35 pass(2 条需先 `bun run build` 服务端产物,与桌面包无关) |
| 独立 code review(medium,范围 11.2..main) | 新代码零发现;9 条发现全在分享代码,与 12.0 已发布版本逐字相同,见第六节 |
| Mac arm64 prod 包 | 已构建(**未签名**),包内核对版本/appId/Electron 42.3.3/shareTarget 存在/附件确认框不存在/LO arm64 + presets 就位 |

**尚未做的真机 QA(必须在签名前后各做一遍关键项)**:

1. 用真实库**副本**冷启动两次 + 续聊(迁移 38→39 条 `share-source`)。
2. 设置 → 供应商断开 GetBot,列表**立即**消失;再连回去正常。
3. 简体中文下分享 → deskfox.cn,切英文分享另一会话 → deskfox.ai;浏览器打开完整展示;取消发布后 404。
4. 从 11.2 与 12.0 各检查一次更新,提示指向 12.1。
5. Finder 拖入 txt / pdf / docx 行为应与 11.2 一致(docx 走路径引用、pdf 走路径引用)。

## 三、Mac 打包与上传(你来做)

本机状态:bun 必须用 **1.3.14**(1.4.x 打不上 photon-node 补丁,安装直接失败);`packages/branding/libreoffice-bundle/macos/` 的 arm64 LO bundle 已就绪;x64 bundle 需 Rosetta。

```bash
git fetch origin && git checkout release/2026.12.1
bun install --frozen-lockfile                      # bun 1.3.14
# 签名公证凭据放 ~/.deskfox-signing/config.env(APPLE_SIGNING_IDENTITY / DESKFOX_NOTARY_*),Developer ID Application 证书需在钥匙串
bash packages/branding/scripts/build-deskfox-electron.sh -Env prod --sign --notarize              # arm64
softwareupdate --install-rosetta --agree-to-license                                                # 如未装
bash packages/branding/scripts/prepare-lo-bundle.sh -Arch x86_64                                   # 产出 libreoffice-bundle/macos-x64
bash packages/branding/scripts/build-deskfox-electron.sh -Env prod --sign --notarize --arch x64    # Intel
```

注意:脚本会 `pkill` 正在运行的正式版 DeskFox(11.2 脚本无 `--keep-running`)。

未签名 arm64 候选(仅供 QA 参照,**不可分发**):`packages/desktop/dist-deskfox/DeskFox-2026.12.1-mac-arm64.dmg`,SHA-256 `e9404a57c016ad27ef285b77a9a0852a6c2d8b1ae12147f9d6ebda6d16ef0661`。签名后哈希会变,台账以签名版为准。

上传与验证按 12.0 的做法(见 `docs/installer-versions.md` 12.0 条目):GitHub Release `ship-mac-prod-2026.12.1`(两架构 dmg + zip + blockmap + `latest-mac.yml`)、Gitee 镜像、国内 CDN `dl.clawtray.com`、官网仓两站下载页更新;回读 latest-mac.yml 四条 SHA-512/大小、六条安装链接 200。

## 四、Windows 打包(Windows 机器)

```powershell
git fetch origin; git checkout release/2026.12.1
bun install --frozen-lockfile          # bun 1.3.14
packages\branding\scripts\build-deskfox-electron.ps1 -Env prod
```

产物 `packages/desktop/dist-deskfox/DeskFox-2026.12.1-win-x64.exe` + `latest.yml`;tag `ship-prod-2026.12.1`。真机 QA 同第二节 1–4 条。

## 五、推 main 与 tag(铁律:推 main 前跟 owner 确认一次)

```bash
git checkout main && git merge --ff-only release/2026.12.1
git push origin main
git tag ship-mac-prod-2026.12.1 && git push origin ship-mac-prod-2026.12.1   # Mac
git tag ship-prod-2026.12.1     && git push origin ship-prod-2026.12.1       # Windows
```

然后按惯例补 `chore(ship): 台账 …` 提交:`docs/installer-versions.md` 两条 12.1 条目把 "(to be filled…)" 换成签名包哈希、Release/CDN 链接与回读结果,并把本文件 status 改 done。

## 六、Review 发现(不阻断,留给 12.2)

范围 `ship-mac-prod-2026.11.2..main`,全部位于分享代码且与 12.0 已发布版本一致:

1. `share-next.ts:320` 迁移后旧分享 `base_url` 为 NULL,非白名单(自建 `enterprise.url`)来源 sync/unshare 永久失败;迁移应按 url origin 回填。
2. `share-next.ts:149` flush 重试无退避/无上限/不区分永久 4xx,400/403/413 每 5s 重放全量会话。
3. `share-next.ts:413` cleanup-required 下 `create()` 直接抛错不先 cleanup,重启前无法再分享。
4. `share-next.ts:422` 企业来源 creating 且 `remote_id` 为空成死局。
5. `share-next.ts:371` `init()` 串行远端 DELETE(各 30s 超时)阻塞 bootstrap,离线最长约 90s。
6. enterprise `maintenance.ts:109` 一个缺 manifest 的半写归档让 pruneBackups 整体失效。
7. `share-next.ts:131` 去掉内存缓存后每事件两次 SELECT、每次 flush 全量 `full()`。
8. `share-next.ts:451` 首发整会话单请求,>16MB 必 413 且反复 allocate/delete。
9. app `public-share.ts:38` 每次点分享都拉完整 `/doc`,应按 server 记忆。

## 七、Owner 本机数据提醒

owner 回退 11.2 时,12.0 写过的库被 11.2 判为"超前"并隔离改名(`opencode.db.incompatible-<时间戳>`),同目录保留。装 12.1 前把它改回 `opencode.db` 即可恢复会话(12.1 含该迁移,兼容)。

## 八、发版前仓库交接给李哲的电脑（2026-11-09）

- 接手确认人：李哲的电脑。发版执行与记录：笑南的电脑。
- 构建来源：`origin/release/2026.12.1`，提交 `dba9c6035b`。本节所在分支只承载交接文档。
- 已验证：笑南的电脑从该提交构建了未签名的 macOS arm64 候选，DMG 完整性、包内版本、架构和 LibreOffice 资源已核对。更新器禁降级 3 项、分享迁移 1 项专项测试通过。Mac 双架构真机验收、签名公证及 Windows 验收待完成。

请李哲的电脑上的协作 Agent 从 `origin/release-handoff` 接收本节，核实已有记录。需要李哲决定的事项由该端确认，再把结论以回执提交到同一交接分支。

1. **11 月 3 日回退的原因和复验门槛。** 官网仓 `10d9a10` 将下载切回 Mac `2026.11.2` 和 Windows `2026.11.1`，11 月 9 日核对的 Electron 更新入口也仍指向这两个版本。请说明当时的故障与复现条件，以及哪些必须在 `2026.12.1` 验收通过后才能重新开放正式更新。
2. **Windows 分工和发版顺序。** 本交接单把双端打包和上传交给笑南，三端协作指南把 Windows 打包与真机验收交给鹏鹏。建议鹏鹏提供同一源码提交的 Windows 包、更新清单、校验值及真机回执，笑南统一发布和回填台账。若由笑南接手 Windows 打包和验收，请安排可用的 Windows 真机。若 Windows 验收晚于 Mac，请明确 Mac 能否先发。

回执明确回退复验项、Windows 执行人和双端上线顺序后，按第二节及新增复验项验收。签名包、校验值和双端回执齐备后，再按第五节提请李哲确认合入及推送。

### 回执（李哲的电脑，2026-11-09）

- 当前身份：李哲的电脑（ComputerName `Zhe's Mac Mini`，已核实）。本回执由该端协作 Agent 写，**第八节两项决定均未经李哲本人确认**，这里只回填可核实的事实；李哲拍板后再追加一条回执。
- 已核：`origin/release-handoff` 两笔提交（`3164b6591`、`0eb6f553d`）只改本交接单与 INDEX；构建来源 `dba9c6035b` 与 `origin/release/2026.12.1` 头一致。

**第 1 项（11 月 3 日回退）事实回填**

- 官网仓 `10d9a10`（2026-11-03 09:00 +0800，`fix(download): restore previous DeskFox releases`）没有正文说明。回退的直接原因：李哲本机使用 12.0 后发现多项功能缺失，自行回装 11.2（2026-11-09 本端会话中李哲原话「最后发布的这个版本改错了很多地方，我本地安装的时候已经恢复使用上一个版本了」）。
- 本端 11.2..12.0 代码审查定位到的功能缺失点，全部在 12.0 附件成本保护（REQ-142/143/144）改动内：
  1. `packages/app/src/components/prompt-input/external-drop.ts`：`routeExternalDrop` 收窄为只有 text/plain 本地文件走路径引用，其他拖入文件一律内联；
  2. PDF 改为内联读取；
  3. `packages/opencode/src/session/prompt.ts`：服务端内联文本截断（50 KiB / 2000 行），并删除原有「Called the Read tool」文件名合成，模型看不到文件名与全文；
  4. 路径引用要求 `ServerConnection.builtin`，非内置连接退化为内联；
  5. 分享前置探测 `publishPublicShare` 要求协议 v1 与 `/doc` 返回 `shareTarget` 枚举。
- 复验门槛（事实层面）：12.1 基线是 `ship-mac-prod-2026.11.2`，上述 5 处代码**不在** 12.1 中，不存在「12.0 故障在 12.1 复现」这一类复验项；要复验的是第二节已列的真机 QA。建议把「拖入 PDF / 大文本 / 非内置连接的路径引用行为与 11.2 一致」作为显式回归项补进第二节清单。
- **待李哲决定**：12.1 验收通过后，官网下载与 Electron 更新入口是否同时切到 12.1（即重新开放正式更新）。

**第 2 项（Windows 分工与顺序）事实回填**

- 两份文档不冲突：三端协作指南（`origin/feat/三端协作-agent接入` v1.1）是分工正本，鹏鹏为 Windows 端开发负责人，含 Windows 打包、上传与真桌面 QA；本单第四节的「Windows 机器」应按指南读作「Windows 电脑 / 鹏鹏」，第三节 Mac 仍由笑南的电脑执行。
- 现状：三个仓库近三天没有来自 Windows 电脑的提交或回执；鹏鹏的 GitHub 仓库权限仍是李哲待办项，权限未开他推不了回执。
- **待李哲决定**：① Windows 由鹏鹏打包与验收、笑南统一发布并回填台账，还是笑南接手并自备 Windows 真机；② Windows 验收晚于 Mac 时，Mac 能否先发。本端建议按指南由鹏鹏执行、Mac 不等 Windows（两端 tag、下载入口与 updater 通道按平台独立），以李哲确认为准。
