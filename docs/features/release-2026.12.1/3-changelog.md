feat-id: release-2026.12.1
status: in-progress
related: ./3-changelog.md

# 2026.12.1 发布交接单(Mac + Windows)

> 交接人:Claude(代 owner 整理,2026-11-09)→ 接手人:笑南。
> 本单回答三个问题:发什么、已经验到哪、剩下你要做什么。做完请把本文件 status 改 done 并补 ship 台账。

## 一、发什么(内容边界)

**基线是 `ship-mac-prod-2026.11.2`**。本版保留 11.2 的附件行为和 Electron 42.3.3，按下表纳入已确认的分享与稳定性修复。

本版只带五项:

| 项 | 来源 | 说明 |
|---|---|---|
| REQ-148 双站分享(deskfox.cn / deskfox.ai) | 12.0 的 share-routing 5 笔 cherry-pick | 含 Windows 路径校验与七天备份脚本;服务端两站已部署,**无需重部署** |
| 配置型供应商断开后列表不刷新 | 新修复 `provider-disconnect-stale` | GetBot 属此类;根因与修法见该 feat 的 3-changelog |
| updater 禁止降级 | 12.0 的 `68397f2a0` 仅代码三文件 | Windows 12.0 已带,12.1 不倒退 |
| 干净工作树 icon.icns 生成修复 | 新 `fix/mac-icon-clean-tree` | 全新 clone 打 prod 包第 2 步必失败,已修 |
| 后台恢复须健康才报就绪 | 12.0 的 `b4b54a58ad` 仅代码三文件(`fix/sidecar-healthy-ready-12.1`,a5c709cc6) | 李哲 2026-11-09 决定纳入;sidecar 重启等待超时不再误报 ready,QA 隔离测试插件。Electron 仍为 42.3.3 |

版本号:macOS `2026.11.2 → 2026.12.1`,Windows `2026.11.0 → 2026.12.1`(两端同号;跳过 12.0 因其已发布且 updater 禁降级)。

**代码位置**:本地 `main` 合并提交链 `06889891f`(发布内容)→ `afee4b9c9`(图标修复)→ 本交接单提交;同一内容已推到远端分支 **`release/2026.12.1`**(main 本身未推,见第四节)。**2026-11-09 更新:候选源码头现为 `ce71d3bd1`**(= `dba9c6035` + 后台恢复修复合并),之前从 `dba9c6035` 构建的未签名 arm64 候选需从新头重建。

## 二、已经验到哪

| 项 | 结果 |
|---|---|
| 完整 `.husky/pre-push` 闸(29 包 typecheck + 六包单测) | 全绿:app 1197+41 / media-gen 140 / 飞书 792 / branding 82(8 Win skip)/ desktop 172 / session-ui 125 |
| opencode 分享专项 / core 迁移 / app public-share / enterprise 分享服务 | 35 pass 2 live-skip / 1 pass / 28 pass / 35 pass(2 条需先 `bun run build` 服务端产物,与桌面包无关) |
| 独立 code review(medium,范围 11.2..main) | 新代码零发现;9 条发现全在分享代码,与 12.0 已发布版本逐字相同,见第六节 |
| Mac arm64 prod 包 | 已构建(**未签名**),包内核对版本/appId/Electron 42.3.3/shareTarget 存在/附件确认框不存在/LO arm64 + presets 就位 |

**尚未做的真机 QA(必须在签名前后各做一遍关键项)**:

1. 用真实库**副本**冷启动两次 + 续聊(迁移 38→39 条 `share-source`)。
2. 设置 → 供应商断开 GetBot,**无需手动刷新**即从已连接列表消失(实测几秒内,Windows 电脑 2026-11-09 测得约 5.3 秒,属 dispose 全部实例后重取的耗时,不算失败);再连回去正常。
3. 简体中文下分享 → deskfox.cn,切英文分享另一会话 → deskfox.ai;浏览器打开完整展示;取消发布后 404。
4. 从 11.2 与 12.0 各检查一次更新,提示指向 12.1。
5. Finder 拖入 txt / pdf / docx 行为应与 11.2 一致(docx 走路径引用、pdf 走路径引用)。
6. 分享兼容边界(第九节第 2 项):双站各发布一次成功;指向协议非 v1 或 `/doc` 无 `shareTarget` 的旧后端时,分享按钮给出「此服务器不支持区域分享。请更新服务器后再分享」而不是静默失败;后端连不上时给出「无法检查服务器是否支持分享」。
7. 运行类验收(第十节口径,李哲 2026-11-09 确认):所有需要运行 DeskFox 的验证在**同一候选提交的 local 本地版**上做,按平台归属(Windows 电脑 / 笑南的电脑),覆盖两次冷启动、旧会话续聊(用私有库副本)、GetBot 断开与重连、双站分享与撤销后 404、PDF / 大文本 / 非内置连接的附件行为与 11.2 一致、后端恢复。正式制品只做静态校验(版本、载荷、签名/公证、更新清单)。**实包升级路径(Windows `11.1 / 12.0 → 12.1`,Mac `11.2 / 12.0 → 12.1`)不在发版前执行**,发版后在首批设备上补验并回填台账;local 的通过不记作正式升级已验。Intel 真机不可用时在回执写明证据与豁免范围。
8. 非内置连接(远端 server)下拖入文件仍走路径引用,与 11.2 一致;**内联**文本附件(非路径引用)大于 50 KiB 时内容完整送达模型(12.0 的服务端内联截断不在 12.1)。路径引用走 `tool/read.ts` 的分段读取(首轮 50 KB 上限 + 提示),这是 11.2 既有行为,**不是本项要求**,也不是回归。

## 三、Mac 打包与上传(笑南的电脑)

> 2026-11-09 李哲决定:Mac 打包、签名公证、上传、`ship-mac-prod-2026.12.1` tag 与 Mac 台账回填全部由笑南的电脑负责;只在独立打包环境执行,打包机上不运行正式版 DeskFox(脚本会强制结束运行中的 DeskFox,本次不改脚本)。Mac 验收通过可先发,不等 Windows。

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

## 四、Windows 打包与发布(Windows 电脑 / 鹏鹏)

> 2026-11-09 李哲决定:Windows 打包、上传、`ship-prod-2026.12.1` tag、Windows 真机 QA 与 Windows 台账回填全部由 Windows 电脑 / 鹏鹏负责,与 Mac 同源同号(候选源码头见第一节)。同样只在独立打包环境执行。

```powershell
git fetch origin; git checkout release/2026.12.1
bun install --frozen-lockfile          # bun 1.3.14
packages\branding\scripts\build-deskfox-electron.ps1 -Env prod
```

产物 `packages/desktop/dist-deskfox/DeskFox-2026.12.1-win-x64.exe` + `latest.yml`;tag `ship-prod-2026.12.1`。真机 QA 同第二节 1–4 条。

## 五、推 main 与 tag(铁律:推 main 前跟 owner 确认一次)

> 2026-11-09 分工:`ship-mac-prod-2026.12.1` 由笑南的电脑打并推,`ship-prod-2026.12.1` 由 Windows 电脑打并推;`main` 的 ff 合并与推送仍须李哲确认后执行,谁先发完谁先提请。

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

李哲的电脑回退 11.2 时，旧版把 12.0 写过的库和随附文件改名隔离。12.1 含对应迁移，恢复前先在副本上核对完整性和会话数量。

恢复步骤(2026-11-09 按第九节第 3 项补细,在李哲的电脑上执行):

1. 完全退出 DeskFox(含菜单栏/托盘进程),确认 `pgrep -f "DeskFox.app/Contents/"` 无输出。
2. 分别备份当前库与隔离库，连同各自的 WAL 和 SHM 一起复制到独立目录。隔离后缀加在每个文件名的末尾，分别是 `opencode.db.incompatible-<时间戳>`、`opencode.db-wal.incompatible-<时间戳>`、`opencode.db-shm.incompatible-<时间戳>`。只匹配 `opencode.db.incompatible-*` 会漏掉 WAL 和 SHM。复制同一时间戳下实际存在的文件。
3. 在另一个验证目录为隔离副本恢复配套文件名 `opencode.db`、`opencode.db-wal`、`opencode.db-shm`，再由 SQLite `.backup` 导出单文件快照。对快照运行 `PRAGMA integrity_check;` 和 `select count(*) from session;`，核对完整性与会话数量。
4. 回退 11.2 之后新建过的会话只在当前库里。若要保留它们,先导出或记下,再决定用哪份库;两份库不能自动合并。
5. 安装 12.1 后、首次启动前，将当前工作库及其 WAL/SHM 移到单独的保留目录，再把已核验的单文件快照复制为工作库 `opencode.db`。做两次冷启动和续聊，避免把原工作库的 WAL 套到恢复后的库上。
6. 验证通过后保留备份目录至少到 12.1 发布完成。

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

## 九、补充交接给李哲的电脑（2026-11-09）

- **发出端**：Windows 电脑（本机系统已核实）。**接手端**：李哲的电脑。请在 `release-handoff` 追加回执，注明修复提交、验收证据和仍需本人决定的事项。
- **位置**：交接在 `origin/release-handoff`，已有回执 `6e7a103559`。候选源码是 `origin/release/2026.12.1` 的 `dba9c6035b`。从候选源码另开修复分支，把 PR 指向发布分支。
- **已验**：按候选提交复跑供应商断开 6 项、更新器版本策略 3 项、分享来源 5 项，全部通过。第二节记录的 macOS arm64 包为未签名候选。最终包、原生升级和两次冷启动待验。

### 请接手处理

1. **区分有意的附件回退与桌面稳定性修复。** 按前一回执的回退原因，保留 11.2 的附件路径行为。请优先评估恢复 `85052235c6` 中的 Electron 钥匙串修复和 `b4b54a58ad` 中的后端进程恢复健康检查。12.1 当前为 Electron 42.3.3，重启等待到 30 秒仍会走就绪路径。验收用最终 Mac 候选，覆盖启动和退出无意外钥匙串弹窗、后端恢复超时不报告就绪、真正健康后恢复就绪。若延后任一修复，请在回执说明原因及放行条件。请补回本分支撤掉的 12.0 发布和验收台账。[Mac 12.0 验收](https://github.com/zoulukuang/deskfox/blob/08a6706592/docs/features/mac-release-readiness/3-changelog.md)
2. **更正并实测分享兼容性。** 第八节回执的第 5 点仍存在。候选 `public-share.ts` 仍要求 v1 且 `/doc` 声明 `shareTarget`。请确认旧后端拒绝分享是预期的兼容边界，并补双站成功及旧后端明确提示的验收。第六节第 1 点请单独判定，旧自建分享没有已记录来源时会被拒绝撤销。若有受影响的存量，请提供经过来源校验的迁移方案或服务端撤销路径，用隔离样例验到撤销后的公开链接不可访问。[前置检查](https://github.com/zoulukuang/deskfox/blob/dba9c6035b/packages/app/src/utils/public-share.ts#L34-L49) · [旧来源校验](https://github.com/zoulukuang/deskfox/blob/dba9c6035b/packages/opencode/src/share/source.ts#L20-L47)
3. **把实包升级和恢复写成可执行的验收项。** Windows 电脑验 `11.1 / 12.0 → 12.1`，笑南的电脑验 Mac `11.2 / 12.0 → 12.1`，覆盖应用内升级、两次冷启动、旧会话续聊、GetBot 断开和重连、双站分享和撤销后 404，以及 PDF、大文本和非内置连接的附件行为。第七节的恢复提示需要补上退出应用、分别备份当前库与隔离库、配套处理 WAL、在副本验证完整性和回退后新增会话的步骤。Intel 真机若不可用，回执请明确证据和本次豁免范围。[Windows 12.0 恢复实录](https://github.com/zoulukuang/deskfox/blob/08a6706592/docs/features/release-readiness/3-changelog.md#L25-L45)
4. **补打包与更新入口步骤。** 当前两端构建都会强制停止运行中的 DeskFox。请恢复隔离输出选项，或明确只在独立打包环境执行。Mac 以最终签名、公证后的四个 ZIP/DMG 资产合并 `latest-mac.yml`，验证按架构分发、SHA-512 和大小。请和 Windows 电脑确认 `latest.yml` 及旧 Tauri 迁移桥是否同时更新，并补清单回读及恢复步骤。Windows 打包与真机 QA 由 Windows 电脑回填，Mac 制品由笑南的电脑回填，是否分平台上线由李哲决定。[Mac 清单生成脚本](https://github.com/zoulukuang/deskfox/blob/dba9c6035b/packages/branding/scripts/deploy-electron-updater.sh#L91-L122)

### 回执（李哲的电脑，2026-11-09，第二条：对第九节）

- 接收第九节（`270457800`，发出端自述 Windows 电脑，Git 署名 `yuesoue`，与 10 月 Windows 2026.12.0 发版提交署名一致）。本端继续只回填事实；涉及发版范围的决定标「**待李哲**」。
- **更正前一回执**：第 5 点（分享前置探测要求协议 v1 与 `/doc` 的 `shareTarget`）随 share-routing cherry-pick 一起**在 12.1 中**，前一回执说「不在」是错的；第 1–4 点仍不在 12.1。

**第 1 项 稳定性修复**

- `85052235c6`「避免钥匙串过早初始化」的代码改动只有 `packages/desktop/package.json` 与 `bun.lock`：Electron 42.3.3 → 42.11.15。恢复它等于恢复 Electron 升级，这是李哲定的 12.1 边界之外的一项。**待李哲决定**。
- `b4b54a58ad`「后台恢复须健康才报就绪 + QA 隔离」：12.1 的 `sidecar-watchdog.ts` / `index.ts` 与 11.2 逐字相同，确实不含；改动限桌面主进程约 30 行加测试，可从候选源码独立 cherry-pick。**待李哲决定是否纳入 12.1**。本端建议纳入：与附件回退无关，12.0 真机已验，与禁降级同属稳定性修复。
- 12.0 台账本笔已补回：`docs/features/mac-release-readiness/`、`docs/features/attachment-cost-guard/` 共 9 个文件从 `08a670659` 原样恢复，`docs/installer-versions.md` 两条 12.0 条目、INDEX 两行（标注已回退、12.1 不含）。

**第 2 项 分享兼容**

- 确认是预期边界：旧后端被拒时用户看到 `share.public.unsupported`「此服务器不支持区域分享。请更新服务器后再分享」，连接失败看到 `share.public.unavailable`。验收项已补进第二节第 6 条。
- 第六节第 1 点：`recordedSource` 只对 deskfox.cn / deskfox.ai / opncd.ai 三个来源推断旧链接；其他自建 `enterprise.url` 的旧分享迁移后 `base_url` 为空，撤销与同步被拒（保留本地链接，不带密钥探测）。受影响存量 = 曾把分享服务器指向自建地址的用户；本端没有这类存量的数据。**待李哲判定**是否存在自建存量；若有，再做带来源校验的迁移或服务端撤销路径，并用隔离样例验撤销后 404。无存量则维持 12.2 留存项。

**第 3 项 实包升级与恢复**

- 升级验收项已写成第二节第 7、8 条，按平台归属（Windows 电脑 / 笑南的电脑）。
- 第七节恢复提示已补成 6 步（退出应用、分别备份当前库与隔离库及 wal/shm、副本 integrity_check、回退后新会话取舍、改名与 checkpoint、保留备份）。
- Intel：李哲的电脑无 Rosetta，x64 包与 Intel 真机都要靠笑南的电脑；不可用时的豁免**待李哲**确认。

**第 4 项 打包与更新入口**

- 事实：`build-deskfox-electron.sh` 第 143–147 行 `pkill -9`、`build-deskfox-electron.ps1` 第 126–128 行 `Stop-Process -Force` 会结束运行中的正式版/预览版/Beta/本地版。恢复隔离输出选项是脚本改动，**待李哲决定**；本端建议本次不改脚本，第三、四节明确「只在独立打包环境执行，打包机上不运行正式版」。
- `latest-mac.yml` 四资产合并与 SHA-512/大小校验、`latest.yml` 与旧 Tauri 迁移桥同步更新、清单回读与恢复：按补回的 12.0 台账（mac-release-readiness / release-readiness 的 3-changelog）照做，Mac 由笑南的电脑回填，Windows 由 Windows 电脑回填。
- 是否分平台上线、Mac 能否先发：**待李哲**（见前一回执第 2 项）。

### 回执（李哲的电脑，2026-11-09，第三条：李哲的决定与执行）

李哲本人 2026-11-09 在本端会话决定（原话：「你提到的几个都按照你的建议来。Windows 打包由鹏鹏来做，发布也由他来发，笑南只负责 Mac 系统的打包和发布。」）。逐项落实如下：

1. **纳入后台恢复修复**：分支 `fix/sidecar-healthy-ready-12.1`，提交 `a5c709cc6`（`b4b54a58ad` 的三文件代码 + 测试，watchdog 8 项测试通过、desktop typecheck 通过、pre-push 闸全绿），已 `--no-ff` 合入 `release/2026.12.1`，**候选源码头 = `ce71d3bd1`**。第一节内容表加第五项；笑南已建的未签名 arm64 候选需从新头重建。
2. **Electron 不升级**：保持 42.3.3，`85052235c6` 的 42.11.15 不进 12.1。
3. **自建分享存量**：李哲未指出存在自建分享服务器的存量，第六节第 1 点维持 12.2 留存项。
4. **打包脚本不改**：两端只在独立打包环境执行，打包机上不运行正式版（已写进第三、四节）。
5. **分工**：Windows 打包、上传、`ship-prod-2026.12.1`、Windows 台账 = Windows 电脑 / 鹏鹏；Mac 打包、签名公证、上传、`ship-mac-prod-2026.12.1`、Mac 台账 = 笑南的电脑；推 main 仍须李哲确认（第三、四、五节已改）。
6. **上线顺序**：Mac 验收通过可先发，不等 Windows。Intel 真机不可用时记录证据后豁免真机性能/体验项，x64 包仍须构建、公证并在 Rosetta 下冷启动验证（此条为本端按 12.0 先例的处理，李哲未单独表态）。
7. **分享域名核实**（李哲问「12.1 所有分享是否都指向 deskfox.cn / deskfox.ai」）：桌面端手动分享按界面语言选 cn / global，`ShareSource.publicSource` 固定 `https://deskfox.cn` / `https://deskfox.ai`；桌面端自动分享（`share: "auto"`）要求配置 `share_target`，否则报错且不分享、不回退。**例外**：不带 `shareTarget` 的调用（CLI `opencode run --share`、未传参的 SDK / TUI）在无登录账号时仍落到 `enterprise.url ?? https://opncd.ai`（`share-next.ts:230`），有登录账号时走上游账号 API；已分享过的会话重新分享沿用原来源。桌面发行版的用户路径全部是双站；CLI 路径是否也强制双站待李哲（建议留 12.2）。

### 回执（笑南的电脑，2026-11-09）

- 已接收 `4f968ac3c1`。Mac 筹备以 `origin/release/2026.12.1` 的 `ce71d3bd1` 为准，保留 Electron 42.3.3。旧头 `dba9c6035b` 的 arm64/x64 包只用作对照。新头的后台恢复与更新策略共 11 项专项通过，desktop typecheck 通过。
- 对照包两架构均已生成，DMG/ZIP 完整性通过。arm64 隔离启动和正常退出通过。x64 第一次在 55 秒观察内未取得完整就绪证据，复测在 Rosetta 下 26.6 秒就绪并正常退出，仍需最终包复验，Intel 真机项另记。旧头的 31 项供应商断开、分享兼容、拖入路径专项通过。两份私有数据库副本分别从 38/39 条迁移打开两次，均收敛到 39 条，完整性通过，项目、会话、消息和分段计数保持一致。此项是数据库层验证，应用内升级和续聊另验。
- Mac 更新清单已用对照包预演，四个 ZIP/DMG 的 SHA-512 与文件大小逐一核对通过。正式清单以签名、公证和装订后的产物重算。先校验 GitHub/CDN 资产，再按放行顺序更新两站 Mac 下载链接和 `latest-mac.yml`，回读两个架构的资产和更新入口。
- 正从 `ce71d3bd1` 重打双架构签名候选。用已有支持保留应用运行的包装脚本在独立工作树和输出目录执行，本次发布分支的打包脚本不变。后续补齐 app/DMG 公证与 Gatekeeper、两条实包升级、GetBot 断开重连、双站分享撤销、Finder 附件与后端恢复验证，再提交 Mac 制品及验收回执。请李哲的电脑如有可用 Intel 真机测试渠道，在本分支补充。
- 第七节已按隔离实现更正 WAL/SHM 备份文件名。李哲的电脑可在副本上先核验，正式库恢复随本机升级验收执行。


## 十、发版前 local 验收口径（Windows 电脑回执，2026-11-09）

- 用户已明确要求：**正式发版前，所有需要运行 DeskFox 的测试统一使用同一候选提交的 local 本地版**。Windows 和 Mac 都按此口径执行。正式制品用于版本、载荷、签名／公证（适用平台）和更新清单的静态校验。使用隔离测试数据，分别记录 local 运行验收与正式制品检查，不把 local 的通过记作 NSIS 覆盖安装或应用内正式升级已执行。
- 交笑南的电脑与李哲的电脑同步上述口径。Mac 签名、公证和合并清单可以继续。双架构冷启动、GetBot、双站分享、附件、后端恢复及数据库副本的运行验证使用 local 版。第二节第 7 项与上一条 Mac 回执若涉及运行正式包，以本节为准。
- Windows 最新候选源码 `ce71d3bd1`。已完整跑仓库 pre-push：29 项类型检查，六包单测和 app 浏览器测试零失败。prod NSIS 静态校验通过：284064953 字节，SHA-256 `57b336cdfbdb4a308e03c5231a84ec6bdfa3a401a9781711c79c7f80bdf175f8`。NSIS 内外载荷完整，包内 app.asar 与核验副本相同，2511 个构建文件、两个插件、LibreOffice 13 个 presets、39 条迁移、latest.yml 的 SHA-512／大小和 blockmap 均已核对。更新器拒绝较低及同版本。构建使用独立工作树和已有的保留应用运行选项，候选源码无改动。冻结安装跳过了阻塞在 node-gyp 的原生安装脚本，锁定的 PowerShell 解析 WASM 已校验。
- 同提交的 Windows local 包已构建，正在做两次冷启动及桌面冒烟。发布前需按结果复核，再更新 GitHub／Gitee、CDN、两站下载及 Windows 两种清单。当前线上 Electron 清单是 2026.11.1，Tauri 迁移桥是 2026.12.0，部署前分别备份并回读。

### Windows local 验收回执（2026-11-09，候选 ce71d3bd1）

- local 包 `deskfox-local 2026.12.1`，独立合成配置和内存库，两次冷启动均 CLEAN，两个测试进程均正常退出。CDP 桌面冒烟 22 项通过，含启动、10 个供应商连接弹窗、5 个面板／会话操作和 6 个设置页。无警告、崩溃或跳过。local 包自带 LibreOffice 将合成 TXT 转为 PDF。运行中的正式版进程保持原样。
- 共享专项首跑在 5 秒默认超时下 33 通过、2 超时、2 公网用例跳过。按包内 30 秒超时复跑两条失败用例，均通过，原始记录保留。供应商断开时序、分享迁移、更新器和看门狗专项均已通过。
- prod 包只做静态校验。仓库 L3 发布物检查全过，NSIS 内部 5244 个文件完整，提取的 app.asar 与已核验的解包产物一致。未执行 prod 安装。
- 待验：local 中使用真实库副本续聊、GetBot 实际断开重连、按界面语言双站分享并撤销后 404，以及 Explorer 原生拖放。内存库冷启动、打开供应商弹窗、源代码分享测试与 Office 独立转换分别记录，不计作上述专项通过。当前保留已校验候选，不推正式 tag 或更新线上入口。

### 回执（李哲的电脑，2026-11-09，第四条：确认第十节口径）

- 李哲本人确认第十节（原话：「对，之前做开发都是按照这个规范做的，所有的测试都是在 local 上完成，确认没问题再打包正式版。」）。第二节第 7 条已按此改写：运行类验收用 local 版，正式制品只做静态校验，实包升级路径发版后补验。笑南的电脑按同一口径执行，Mac 签名、公证、清单合并照常。
- 本端对该规则的评估已交李哲（见本端会话），结论：规则成立，但 local 与 prod 之间只有一组差异点是 local 验不到的（应用身份与数据目录、签名/公证与 Gatekeeper、更新通道与清单、NSIS 覆盖安装、已有正式库的迁移）。建议在不碰正式数据的前提下补一层最薄的正式包冒烟（隔离账户或干净虚拟机装签名包冷启动两次；用正式库**副本**走一次 11.x → 12.1 升级；先发 GitHub Release 并切清单，确认 11.x 收到更新提示后再切官网下载）。是否采纳**待李哲**，采纳则补进第二节。

### 回执（笑南的电脑，2026-11-09，ARM local 验收）

- 从 `ce71d3bd1` 构建 ARM local，独立 `ai.deskfox.app.local`、LOCAL 徽标和 `opencode-local.db`，运行中核对了进程加载的 `app.asar`，更新器显示 disabled。两次冷启动均 CLEAN，正常退出。pre-push 的 29 项类型检查、六包单测和 app 浏览器测试零失败。Playwright 主套件 155 项、公开页面桌面和移动两项通过。回环模型可续聊，超过 50 KiB 的合成文本附件连同末尾标记完整送达。
- **国内分享写入阻断，交李哲的电脑。** 本地包创建国内分享返回 500，直接请求 `deskfox.cn` 创建接口返回 503 `ShareUnavailable`，健康探测仍为 200。只读核查发现分享 service active，数据所在根文件系统 100% 且可用 0，服务要求至少 1 GiB。Docker 容器日志目录约 23 GiB，New API 日志目录约 7.5 GiB，分享数据目录约 70 MiB。海外站直接创建及撤销为 200。请协调国内主机扩容或按日志留存规则轮转，恢复可用空间后由笑南使用同一 local 包复验发布、展示和撤销。保留现有分享数据与备份。
- 仓库 `verify:deskfox` 的 L0 全仓类型检查通过，lint 在 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163` 的 JSX Tailwind 类 `\200B` 报过时八进制转义。此行在 11.2 基线和候选间相同。文件读取专项两项超过默认 5 秒超时，单独将诊断上限设为 20 秒后整份 39 项通过，默认超时问题仍保留记录。
- Intel 原生依赖已就位。按用户顺序，ARM 验收通过后再构建 Intel local，由用户在 Intel 真机执行冷启动、使用和退出验收。

### 回执（李哲的电脑，2026-11-09，第五条：收到国内分享阻断与发版规范）

- 收到笑南的电脑 ARM local 验收回执（`628031eb7`）。ARM local 两次冷启动 CLEAN、pre-push 全绿、Playwright 155 项通过、50 KiB 以上附件完整送达，记为门 2 Mac 侧通过项；国内分享项**阻塞**，归因在服务端不在候选。
- **国内分享写入阻断（deskfox.cn 返回 503 `ShareUnavailable`，根因根文件系统 100%，Docker 容器日志约 23 GiB、New API 日志约 7.5 GiB，分享数据仅约 70 MiB）**：本端已定位到 SSH 别名 `deskfox-cn`，但本端 Agent 对生产主机的读写操作需李哲授权，**暂未登录、未改动任何东西**。处置建议（交李哲或笑南执行，先只读后清理）：
  1. 只读确认：`df -h /`、`docker ps`、`du -sh /var/lib/docker/containers/*/*-json.log | sort -h | tail`、New API 日志目录大小。
  2. 释放空间：对最大的容器 json 日志 `truncate -s 0`（容器不停、不删分享数据）；New API 历史日志压缩或移走；不动 `/var/lib/deskfox-share` 数据与备份（DEPLOYED-20261012 规定不能靠删墓碑释放容量）。
  3. 防复发：`/etc/docker/daemon.json` 加 `"log-opts": {"max-size": "50m", "max-file": "5"}`（对已存在容器需重建才生效）；New API 日志加 logrotate；给根分区加 85% 告警。
  4. 恢复后由笑南用同一 local 包复验国内分享发布、展示、撤销后 404；海外站本轮已 200，不受影响。
  这是服务端运维事项，不改候选头 `ce71d3bd1`，不影响 Windows 侧与 Mac 其余验收项继续。
- lint 在 `prompt-input/index.tsx:163` 的八进制转义告警在 11.2 基线已存在，不作为本版阻断；记入 12.2 留存。文件读取专项默认 5 秒超时在 20 秒下 39 项全过，同样留存。
- **发版规范已成文**：`origin/feat/release-gate-spec`（`e48c40494`）新增 `docs/governance/测试与发布规范.md` 与 CLAUDE.md「发版约定（速查）」。12.1 剩余步骤按该文第五节（正式制品：静态校验 + 隔离冒烟）与第六节（分级放行：制品 → 清单 → 观察 24 小时 → 官网 → main/tag/台账）执行；两端请在动手前读一遍第八节 12 条速查。该分支合并待李哲。

### 回执（笑南的电脑，2026-11-09，ARM local 补验）

- 收到 `b599c447dd`，已读新规范。保持候选 `ce71d3bd1`。ARM local 的 `verify:deskfox` L2 冒烟分两轮，启动 1 项、供应商弹窗/面板/设置/文件预览 20 项，均零警告、崩溃和跳过。Finder 真拖入 TXT、PDF、DOCX 均显示为路径引用。
- 同一 local 包实际终止其专属后端进程，26.1 秒后新进程在同一端口健康。用 38 和 39 条迁移记录的私有库副本各冷启动两次、正常退出，均为 39 条，`quick_check` 通过，项目/会话/消息/分段数量保持一致。全程用合成会话和回环模型验续聊与大文本附件。
- 海外站已用同一个 local 包完成合成会话分享、公开页面读到回复、撤销后 404。国内仍待恢复磁盘空间。追加只读确认，当前 `new-api` 的 Docker `json-file` 单个日志 23,956,328,524 字节，根分区可用 0；未清理日志。请李哲确认日志留存和运维操作范围，或通知恢复后复验。
- 对照上一 Mac ship tag 审核了 20 个测试文件，无删除文件，减去的 6 行均是替换 import，无原断言删改。补跑 enterprise 分享服务和生产制品相关测试 37 项通过。旧 lint 在独立副本确认可用 `String.raw` 保留原 Tailwind 类同时消除解析报错，当前发布源码沿用已冻结提交。
- 按 12.0 台账的原速口径运行 `TIMELINE_CPU_THROTTLE=1 PLAYWRIGHT_PORT=14321 bun run test:bench`，43 项性能单测与 65 项原速浏览器场景全部通过。早先启动的默认 30 倍限速套件已停止，原始日志保留。

### 回执（Windows 电脑，2026-11-09，local 专项补验）

- 使用 `ce71d3bd1` 的 Windows local 包。两份历史库副本分别从 38 和 39 条迁移记录启动两次，均落在 39 条。`quick_check` 通过，原有会话可读取，合成会话用回环模型跨重启续聊。备份文件及 WAL 的哈希保持一致。
- GetBot 设置页完成连接、断开和重连。断开后约 5.3 秒从已连接列表移除，无需刷新，禁用状态写入配置，重连后恢复。模型目录用合成响应。5.3 秒是本次 Windows 实测，保留给李哲的电脑复核第二节的「立即」口径。
- 在独立 Explorer 窗口选中四个合成文件，用 Windows 原生鼠标事件跨窗口拖入同一 local 包。大 TXT、PDF、DOCX 显示为路径引用，PNG 显示为内联图片。本轮原生拖放覆盖内置连接。
- 67,584 字节的内联 TXT 经 local 后端送给回环模型，单次请求包含全部 1,024 行。终止专属 local 后端后，新进程在原端口用原凭据通过健康检查，耗时 25.8 秒。
- 同一个 TXT 在独立临时项目中改走 `file:` 路径引用，首轮送到回环模型的是 787／1,024 行，附 `Output capped at 50 KB` 提示。`tool/read.ts` 与 `session/prompt.ts` 相对 `ship-mac-prod-2026.11.2` 无源码差异。请李哲的电脑确认第二节第 8 项的「完整送达」是否要求路径引用也在首轮全量送达，还是沿用 11.2 的分段读取行为。非内置连接的原生拖放仍待复验。
- 海外分享通过 Windows local 后端用合成会话验证，指定 `global` 后公开页面可打开且包含合成内容，撤销后 HTTP 404。语言到目标的映射由既有测试覆盖，Windows 双语 UI 公网链路仍待补验。
- **国内分享仍阻塞。** Windows local 创建国内分享返回 HTTP 500，直接复验国内创建接口返回 HTTP 503 `ShareUnavailable`，健康接口仍为 200。磁盘写满证据见笑南的回执。请李哲的电脑在国内服务恢复后回填通知，Windows 侧用同一个 local 包复验发布、展示和撤销后 404。
- Windows 用户要求 local 全部通过后再决定是否准备正式版。本回执仅同步验证结果，保持发布待定。

### 回执（李哲的电脑，2026-11-09，第六条：答 Windows 电脑 local 专项补验）

- 收到 `521e740d9`。Windows 侧迁移 38/39 → 39、GetBot 断开重连、Explorer 原生拖放(内置连接)、67,584 字节内联 TXT 全量送达、海外分享发布与撤销 404,均记为门 2 Windows 侧通过项。
- **第二节第 8 项口径澄清**:该项针对的是 12.0 引入的**服务端内联文本截断**(50 KiB / 2000 行)与文件名合成丢失,12.1 不含,所以要求的是「内联附件完整送达」,Windows 实测 1,024 行全量通过即满足。`file:` 路径引用首轮 787/1,024 行并提示 `Output capped at 50 KB`,来自 `tool/read.ts` 的分段读取,与 `ship-mac-prod-2026.11.2` 源码一致,是 11.2 既有行为,**不是回归、不要求改**。第 8 项文字已改写明确。
- **第二节第 2 项口径澄清**:「立即」改为「无需手动刷新即消失」,5.3 秒是 `global.dispose` 清全部实例后重取的耗时,接受;已改写。
- **国内分享**:仍阻塞于服务端磁盘。本端已完成只读诊断(根分区 40G 满;`new-api` 容器 json 日志 23 GiB、`/opt/new-api/logs` 87 个文件 7.5 GiB;分享数据 70 MiB;Docker 无日志上限配置)。清理与轮转命令已交李哲在本机执行(本端 Agent 对生产主机的写操作被会话策略拦截),完成后在此追加回执并通知两端复验。
- 发布仍待定,与 Windows 电脑一致:local 全部通过(含国内分享复验)后再进门 3 正式制品。

