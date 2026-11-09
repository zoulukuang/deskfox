feat-id: release-2026.12.1
status: in-progress
related: ./3-changelog.md

# 2026.12.1 发布交接单(Mac + Windows)

> 交接人:Claude(代 owner 整理,2026-11-09)→ 接手人:笑南。
> 本单回答三个问题:发什么、已经验到哪、剩下你要做什么。做完请把本文件 status 改 done 并补 ship 台账。

## 一、发什么(内容边界)

**基线是 `ship-mac-prod-2026.11.2`**。本版保留 11.2 的附件行为，运行时更新为 Electron 42.11.15，并按下表纳入已确认的分享与稳定性修复。

本版只带六项:

| 项 | 来源 | 说明 |
|---|---|---|
| REQ-148 双站分享(deskfox.cn / deskfox.ai) | 12.0 的 share-routing 5 笔 cherry-pick | 含 Windows 路径校验与七天备份脚本;服务端两站已部署,**无需重部署** |
| 配置型供应商断开后列表不刷新 | 新修复 `provider-disconnect-stale` | GetBot 属此类;根因与修法见该 feat 的 3-changelog |
| updater 禁止降级 | 12.0 的 `68397f2a0` 仅代码三文件 | Windows 12.0 已带,12.1 不倒退 |
| 干净工作树 icon.icns 生成修复 | 新 `fix/mac-icon-clean-tree` | 全新 clone 打 prod 包第 2 步必失败,已修 |
| 后台恢复须健康才报就绪 | 12.0 的 `b4b54a58ad` 仅代码三文件(`fix/sidecar-healthy-ready-12.1`,a5c709cc6) | 李哲 2026-11-09 决定纳入;sidecar 重启等待超时不再误报 ready,QA 隔离测试插件 |
| Electron 42.3.3 → 42.11.15 维护更新 | 12.0 的 `85052235c6` 同内容,重算锁文件(`fix/electron-42-11-15`,a2a9bba23,R4 override bun.lock) | 李哲 2026-11-09 决定纳入;修 safeStorage 过早初始化导致的钥匙串弹窗与 ⌘Q 不退出(上游 PR #50419);Windows 12.0 已带此运行时,12.1 不倒退 |

版本号:macOS `2026.11.2 → 2026.12.1`,Windows `2026.11.0 → 2026.12.1`(两端同号;跳过 12.0 因其已发布且 updater 禁降级)。

**代码位置**:本地 `main` 合并提交链 `06889891f`(发布内容)→ `afee4b9c9`(图标修复)→ 本交接单提交;同一内容已推到远端分支 **`release/2026.12.1`**(main 本身未推,见第四节)。**2026-11-09 更新(二):候选源码头现为 `e766f06ca`**(= `ce71d3bd1` + Electron 42.11.15 合并)。运行时变更,**此前基于 `ce71d3bd1` 的全部 local 包与运行类验收作废**,两端重建 local 重跑(范围见第八条回执 D 节);基于旧头的测试删改审计、迁移条数记录可沿用并注明旧头。

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

### 回执（笑南的电脑，2026-11-09，国内分享复验与 Intel local）

- 国内主机释放空间后，分享数据分区可用 4.9 GiB、服务 active。使用原 `ce71d3bd1` ARM local 包和合成会话复验，`deskfox.cn` 和 `deskfox.ai` 都能发布，公开页面均包含合成回复，撤销后均返回 404。回环模型续聊与大于 50 KiB 的文本附件也复测通过。交 Windows 电脑，原 Windows local 包可以复验国内分享。
- ARM 国内项通过后，从同一提交构建 Intel local。应用标识 `ai.deskfox.app.local`，版本 2026.12.1，主程序、LibreOffice、node-pty 和 watcher 均核对为 x86_64，内置 LibreOffice presets 齐备，ZIP 完整性通过。
- Intel 真机交付文件 `DeskFox-Local-2026.12.1-mac-x64.zip`，417025780 字节，SHA-256 `fb63798c00b500fb3ce9e520b775f0d181d64763d22ed7b5984d881042eb964b`。
- 同一 x64 local 在 Apple 芯片机器用 Rosetta 运行，隔离 macOS 配置下两次均启动到后端健康并显示 LOCAL。第一次确认独立 local 库与更新器 disabled。第二次按 ⌘Q，窗口记录退出意图，但进程 35 秒内未结束，采样见 `SecItemCopyMatching` / `SecKeychainItemCopyContent` 等待。第三次使用应用内置 onboarding 隔离，保留原 macOS 用户目录，27.0 秒达到后端健康，⌘Q 后仍在 35 秒内未退出。交 Intel 真机用常用 macOS 用户复验两次冷启动与 ⌘Q，并记录任何钥匙串提示或进程残留。

### 回执（李哲的电脑，2026-11-09，第七条：国内分享已恢复、Intel local 退出挂起的归因）

- **国内分享已恢复**(收到 `425ad75ab`)。本端只读回读:根分区 40G 已用 11G、可用 27G,`new-api` 容器日志已清到 12K,`/opt/new-api/logs` 剩 14 个文件 2.1G,`deskfox-share` active。**但 `/etc/docker/daemon.json` 与 `/etc/logrotate.d/docker-containers` 都不存在**,日志上限与轮转尚未配置;按过去 10 天约 2.3 GB/天的增速,不配置约两周后会再满。配置命令已交李哲在本机执行,完成后在此追加。Windows 电脑可用原 local 包复验国内分享发布 / 展示 / 撤销 404。
- **Intel(x64)local 在 Rosetta 下 ⌘Q 35 秒不退出,采样停在 `SecItemCopyMatching` / `SecKeychainItemCopyContent`**:这不是新问题。12.0 发版记录(`mac-release-readiness/3-changelog.md`「用户随后报告钥匙串系统弹窗」「钥匙串修复实施」与 `R4-runtime-review.md`)已归因为 **Electron 42.3.3 的 safeStorage 过早初始化缺陷**(上游 PR #50419,42.4.1 回补),症状正是合成 HOME 下进程不退出,并伴随「找不到用于储存 DeskFox Key 的钥匙串」弹窗;12.0 以 Electron 42.11.15 维护更新修复,新旧运行时在正常 HOME 与合成 HOME 的对照退出 0 / 残留。12.1 候选 `ce71d3bd1` 保持 42.3.3,所以该缺陷**在 12.1 中存在**,11.2 同样带着它。
- 由此产生一个**待李哲**的范围决定(第三条回执第 2 项「Electron 不升级」需要重议):
  - 保持 42.3.3:Mac 上保留已知的退出挂起 / 钥匙串弹窗风险;**Windows 上 12.0 已发布 42.11.15,12.1 若回到 42.3.3 等于把这个已修的缺陷重新发给 Windows 用户**。
  - 纳入 `85052235c6`(仅 `packages/desktop/package.json` + `bun.lock`,同一 42 主版本维护线):需 R4 黑名单 override(`bun.lock`)并由李哲二次确认;候选头变更,两端门 2 重做;12.0 已在该运行时上完成原生回归、签名、公证与发布,不是 12.0 回退的原因。
  - 本端建议纳入。
- Intel 真机复验(常用 macOS 用户、两次冷启动、⌘Q、钥匙串提示)仍按笑南的电脑交接执行,结果用于判断上面两条路径的实际影响;若选择纳入 Electron 更新,则在新候选头上复验。

### 回执（笑南的电脑，2026-11-09，ARM 界面与非内置连接补验）

- 用 `ce71d3bd1` 的 ARM local 制品在独立配置中完成 GetBot 连接、断开和重连。仅模型目录用合成响应，配置和供应商列表经过实际内置后端。断开后约 2.84 秒从列表移除，无需手动刷新。核对了断开后写入 `disabled_providers`、重连后移除以及列表恢复。
- 同一制品在设置中把隔离后端添加为独立的 HTTP 连接并切换过去。通过 CDP 文件拖放向会话编辑框送入实际 TXT、PDF、DOCX，三项均生成相对路径引用，无 `data:` 载荷。原生 Finder 拖放在此前的内置连接中实测。
- 同一 ARM local 制品从会话菜单实际发布两条合成会话。简体中文界面选中 `deskfox.cn`，英文界面选中 `deskfox.ai`，两个公开页面均读到合成回复。用各自语言界面的取消发布按钮撤销，两条链接均返回 HTTP 404。
- 已读 `7f60be4b5d`。现有 x64 local 交 Intel 真机做退出复验，Electron 版本变更等李哲确认。

### 回执（李哲的电脑，2026-11-09，第八条：Electron 升级已合入、无 Intel 真机的替代方案）

李哲决定(2026-11-09):① Electron 升 42.11.15 纳入 12.1;② **不做 Intel 真机测试**,由本端定替代方案并照此执行。

**A. 已执行**
- `fix/electron-42-11-15`(`a2a9bba23`):仅 `packages/desktop/package.json` + `bun.lock`(9+/19-,全部为 electron 及其传递依赖 extract-zip / yauzl / get-stream 的解析变化),R4 override 标记在 commit message;desktop 176 项测试通过;pre-push 闸在该头上全绿。已 `--no-ff` 合入 `release/2026.12.1`,**候选头 = `e766f06ca`**,fix 分支已删。
- 第一节内容表加第六项;第二节口径不变。

**B. x64 无真机的替代验证(笑南的电脑,Apple 芯片 + Rosetta)**
1. x64 prod 从 `e766f06ca` 构建、深签、公证、staple;`codesign --verify --deep --strict`、`spctl --assess --type execute`、`xcrun stapler validate` 三项通过。
2. 架构核对:`lipo -archs` / `file` 检查主程序、全部 Helper、node-pty、watcher、LibreOffice soffice 与其库均为 x86_64(local 已做过,prod 包再做一次)。
3. x64 **local**:合成 HOME 与常用 HOME 各一轮,冷启动到后端健康、**⌘Q 后 15 秒内进程全部退出、无钥匙串弹窗**。这是 42.3.3 下复现过的失败场景,必须变绿;变绿即证明升级生效。
4. x64 **prod 签名包**在隔离账户:安装、冷启两次、⌘Q、Gatekeeper 首开无阻;记录启动到就绪耗时与 12.0 的 Rosetta 延迟记录对照。
5. x64 下走核心路径一遍:续聊(库副本)、GetBot 断开重连、拖入 PDF / DOCX 路径引用、双站分享与撤销 404、Office 转 PDF(让 x86_64 的 LibreOffice 真跑)。
6. 写明 Rosetta 验不到的三样:真实 Intel CPU 性能、独立 GPU / Metal 渲染差异、老 Intel 机型缺 AVX2 等指令集。记为「未验」,不写成通过。

**C. x64 分级放行(门 4,李哲 + 笑南)**
7. arm64 先进 `latest-mac.yml`;**x64 的 zip / dmg 晚 24 小时**再合并进清单(`deploy-electron-updater.sh` 支持单 arch 退化);官网 x64 下载链接在 x64 进清单且金丝雀通过后再切,期间保持 11.2。
8. 金丝雀:切 x64 清单后看 Plausible 遥测(`telemetry.ts` 的 `app_open`,props 含 `version` / `arch`):出现 version=2026.12.1 且 arch=x86_64 的 install_id ≥ 3 个、持续 24 小时无同一 install_id 反复重启,再切官网 x64 链接。Plausible 权限在李哲。
9. 回退:x64 出问题先把 x64 条目从 `latest-mac.yml` 移除(arm64 不受影响),官网 x64 链接保持 11.2,再出 hotfix;不让 x64 用户降级。
10. 待李哲:Intel 版发布说明是否注明「未在 Intel 真机验证,遇启动/退出问题请反馈」。

**D. 门 2 重跑范围(候选头 `ce71d3bd1` → `e766f06ca`,运行时变更)**
- 两端重建 local 包,重跑:两次冷启动、续聊(库副本)、GetBot 断开重连、原生拖放、双站分享与撤销、后端恢复、`verify --changed` / `--cold`、performance `test:bench`;Windows 另重做 NSIS 静态校验。
- 可沿用并注明旧头:测试删改审计、迁移 38/39 → 39 的记录、海外站服务端行为。
- 国内分享服务已恢复,Windows 侧国内分享复验直接在新 local 包上做一次即可。


### 回执（Windows 电脑，2026-11-09，非内置连接与国内分享复验）

- 同一 `ce71d3bd1` Windows local 制品，在隔离配置里通过「切换服务器」添加并选中独立的 HTTP 回环连接。核对项目／事件请求确实到达与内置连接不同的 HTTP 端口。实际用 Windows 原生鼠标事件将 Explorer 的 TXT、PDF、DOCX、PNG 混选跨窗口拖入编辑框。前三项保持规范化路径引用，PNG 保持内联图片。
- 已接收李哲的电脑 `3ff6e3f181` 的验收口径。67,584 字节内联 TXT 在单次回环模型请求中完整包含 1,024 行，满足第二节第 8 项。`file:` 路径引用的首轮分段读取保留为 11.2 既有行为。GetBot 断开后无需手动刷新即消失的实测也满足修订口径。
- 已接收国内服务恢复回执 `7f60be4b5d`。Windows local 的简体中文界面发布到 `deskfox.cn`，英文界面发布到 `deskfox.ai`。两条公开页面均返回 HTTP 200，公开快照均含对应合成回复。隔离 Chrome 配置在两站都渲染出合成回复。海外页在本机有两轮 20 秒内仍空白，延长观察后于 65.55 秒显示内容。发布后在同一会话重新打开分享菜单，直接从桌面界面撤销，两条链接均返回 HTTP 404。
- 以上为旧头 `ce71d3bd1` 的通过证据。已接收 `41e7c9b055`，Windows 正从 `e766f06cab` 构建 local 包并按门 2 复验运行项目。按本端用户要求，正式制品准备保持暂停，等待 local 复验完成及用户决定。

### 回执（李哲的电脑，2026-11-09，第九条：新运行时 arm64 合成 HOME 退出检查通过）

- 在李哲的电脑(Apple 芯片)从候选头 `e766f06ca` 构建 arm64 local(`-Env local --no-bundle`,Electron 42.11.15),用**合成 HOME**启动 30 秒(6 个进程就绪),AppleScript quit 后**1 秒内全部进程退出**,日志无 keychain / SecItem 字样。这正是 42.3.3 下 12.0 记录过残留、以及 x64 local 在 Rosetta 下 35 秒不退出的同类场景;arm64 侧已变绿。构建日志与合成 HOME 在本机会话目录,不入仓。
- 本检查只覆盖 arm64 + 合成 HOME 的启动 / 退出路径,**不替代**第八条 B 节 x64 Rosetta 验证与两端门 2 重跑;供笑南的电脑对照。
- 环境备注:electron-builder 拒绝从 `/private/tmp` 下的工作树打包(「denied access to system or unsafe path」),构建须在用户目录下的工作树进行。

### 回执（Windows 电脑，2026-11-09，Electron 42.11.15 的 local 复验）

- 从 `e766f06cab` 在独立工作树冻结安装并构建 `2026.12.1` Windows local。打包记录确认 Electron 42.11.15，应用及 LibreOffice presets 就位。桌面包类型检查及门禁桌面 176 项通过。性能按原速运行，43 项单测和 65 个浏览器场景通过。
- 两种连接分别用 Windows Explorer 原生拖入同一组夹具。内置和独立 HTTP 连接的 TXT、PDF、DOCX 保持路径引用，PNG 保持内联图片。67,584 字节内联 TXT 再次在单次回环模型请求中完整包含 1,024 行，符合第六条回执的口径。
- 新包简体中文界面发布到 `deskfox.cn`，英文界面发布到 `deskfox.ai`。两站公开页与公开快照通过，Chrome 实际显示合成回复。发布后在同一会话重开分享菜单并撤销，均返回 HTTP 404。国内页 3.11 秒显示。海外首轮在公开内容检查中超时，单独复测公开页及数据均为 200、标题和回复齐全，Chrome 渲染耗时 74.36 秒，保留该时延记录。
- GetBot 在合成模型列表下连接、断开和重连通过，约 7.1 秒后从列表移除，无需刷新，禁用配置写入并在重连后移除。终止测试专属后端后，替换进程在原端口以原凭据通过健康检查，耗时 27.0 秒。包内 LibreOffice 将合成 TXT 转为有效 PDF。
- 两次冷启动健康检查均 CLEAN。两份历史库副本分别从 38 和 39 条迁移记录启动两次，均以 39 条结束。`quick_check` 通过，既有会话可读，合成会话跨重启续聊，原备份及 WAL 哈希保持一致。39 条副本的首轮模型等待超时，改用独立临时项目复测通过。
- 首轮合并冒烟在重载探针记录了空响应警告。独立测试配置再做两次冷启动与桌面冒烟，22 项均通过，警告未复现，两轮正常退出。额外用 Bun 扫描整个 desktop 目录时，`draft-store.test.ts` 因测试运行器缺少 `node:sqlite` 未执行，仓库规定的 176 项门禁单测另行跑通。
- 独立项目里从实际文件树打开 TXT 和 PDF，核对查看器渲染出合成文本与 PDF 页面。Windows local 的门 2 运行复验通过，正式制品准备保持暂停，待用户决定。
### 回执（笑南的电脑，2026-11-09，Electron 42.11.15 双架构 local 复验）

- 已接收 `41e7c9b055` 和 `34f8025d4a`。本端用户确认暂缓 Intel 真机测试，以 Apple 芯片上的 Rosetta 做本轮替代验证。真实 Intel CPU 性能、独立 GPU / Metal 差异及旧机型指令集兼容性留作未验。
- 在独立工作树对 `e766f06cab` 冻结安装并重打 ARM 和 Intel local。两包均为 2026.12.1，内置 Electron 42.11.15。x64 校验了主程序、Electron Framework、Helper、x64 watcher、node-pty、soffice 及 LibreOffice 库等 132 个目标架构二进制。打包沿用已有的隔离输出包装脚本，候选源码不变。
- pre-push 的 29 项类型检查和六包测试通过。Playwright 主套件首轮 154 通过、1 项终端焦点失败，该文件重复 12 项全部通过，随后全量 155 项通过。公开分享页桌面和移动 2 项通过；原速性能套件 43 项单测、65 项浏览器场景均通过。全仓 lint 仍有基线已记录的 JSX `\200B` 八进制转义解析错误，相关源文件无变化。
- ARM local 两次隔离冷启动和正常退出通过，核对 LOCAL、实际加载的 `app.asar`、独立数据库及更新器 disabled。对运行中的 local 执行 `verify --changed` 和独立 boot 检查，28+1 项通过，无警告、崩溃或跳过。冷启动直接复用仓库 `cold-start.py` 探针检查候选包。
- ARM 实测原生 Finder 与独立 HTTP 连接下的 TXT/PDF/DOCX 路径引用，合成模型续聊及大于 50 KiB 的完整内联文本，SQLite 副本重新打开后续聊，以及终止专属 sidecar 后 25.6 秒同端口恢复健康。GetBot 复测断开 3.58 秒后无需刷新消失，重连恢复，首轮曾在等待 `global.dispose` 时超时。双语界面分别发布到 `deskfox.cn`、`deskfox.ai`，公网显示合成回复，从界面撤销后均返回 404。
- Rosetta x64 local 在合成 HOME 和常用 HOME 加应用内置隔离配置下均确认 LOCAL 和后端健康。合成 HOME 从启动到后端健康 48.3 秒，从发出 ⌘Q 到本包进程全部退出 14.75 秒。常用 HOME 完整复测分别为 28.3 秒和 7.92 秒。两轮退出码均为 0，未观察到 SecurityAgent 钥匙串提示或钥匙串日志。常用 HOME 首轮曾超过 15 秒，第二轮退出 13.77 秒但读取 LOCAL 的调试连接超时，均保留为首轮差异。
- 从 x64 local 包内直接调用 x86_64 LibreOffice，将合成 DOCX 转为 PDF 并提取到文本。首轮 90 秒超时，采样停在 Rosetta/dyld 装载，内置盘副本对照和原包复跑均成功，产出均为 10,488 字节。该项覆盖实际内置 Office 载荷运行。
- Rosetta x64 local 的合成模型续聊、大于 50 KiB 的内联文本完整送达、SQLite 副本重新打开后续聊均通过。两站由实际 local 后端发布，公网显示合成回复，撤销后均返回 404。首轮请求供应商目录超时，复跑使用包内模型目录快照和回环模型，分享仍走实际公网服务。
- Rosetta x64 local 在隔离的默认项目中用原生 Finder 和 CoreGraphics 鼠标事件分别拖入真实 TXT、PDF、DOCX，均生成路径引用。GetBot 使用合成模型目录连接、断开和重连，断开后 18.34 秒从列表消失，无需手动刷新，禁用配置随断开和重连正确写入和清除。
- 双语界面整链路以 ARM 实测为准。x64 两站公网发布、展示及撤销通过了实际 local 后端，另跑的双语菜单脚本在调试连接读取时超时，未取得 x64 菜单端到端证据。

### 回执（李哲的电脑，2026-11-09，第十条：门 2 两端收口，门 3 待李哲放行）

- 收到 Windows 电脑 `e9f74b69e` 与笑南的电脑 `73dd5a652`。候选头 `e766f06ca`(Electron 42.11.15)上,**两端门 2 运行类验收全部通过**:自动化闸、原速性能套件、冷启动、库副本迁移与续聊、GetBot 断开重连、两种连接下原生拖放、内联大文本完整送达、双站按语言发布与撤销 404、后端自愈、LibreOffice 转换。
- **x64 Rosetta 替代验证(第八条 B 节)结果**:132 个二进制全为 x86_64;合成 HOME 与常用 HOME 下 ⌘Q 后进程分别 14.75 秒与 7.92 秒全部退出、退出码 0、无钥匙串提示(42.3.3 下为 35 秒不退出),升级目的达成;x86_64 LibreOffice 真跑转换成功。Rosetta 首轮多项有 48–90 秒的装载延迟并有一次超时,记为 Rosetta 时延,不是缺陷;真实 Intel 性能、GPU、旧机型指令集按决定留作未验。
- 两端一致记录 **deskfox.ai 分享页从国内访问首屏 65–74 秒**(国内站 3 秒)。不阻断 12.1,记入 12.2 运维项:海外站静态资源 / 公开页走国内可达 CDN 或预渲染。
- 可沿用的旧头证据:测试删改审计(无删除,6 行为 import 替换)、迁移 38/39 → 39。
- **门 3 已由李哲放行(2026-11-09,见第十一条)**。笑南的电脑出 arm64 + x64 prod(深签 / 公证 / staple,`codesign --verify --deep --strict`、`spctl`、`stapler validate`)、静态校验、隔离账户装包冷启两次与副本升级;Windows 电脑出 prod NSIS、`verify.ts --release --env prod`、隔离账户/虚拟机装包冷启两次与 11.1 / 12.0 副本覆盖升级。制品 SHA-256 与字节数写进 `docs/installer-versions.md` 两条 12.1 条目。**不推 tag、不切清单、不动官网**,那是门 4。
- 其余待李哲:Intel 版发布说明是否注明未在真机验证;国内主机 Docker 日志上限与 logrotate 尚未配置(命令已交李哲)。

### 回执（李哲的电脑，2026-11-09，第十一条：门 3 放行）

李哲原话:「门 3 放行,两端开始打正式包」。候选头 `e766f06ca` 不变,两端按《测试与发布规范》第五节执行,**只出包、校验、隔离冒烟;不推 tag、不切清单、不动官网**(门 4 另行放行)。

**笑南的电脑(Mac)**
1. 独立打包环境,`build-deskfox-electron.sh -Env prod --sign --notarize`,arm64 与 x64 各一份(x64 需 LO x86_64 bundle)。
2. 静态校验:版本 2026.12.1、appId `ai.deskfox.app`、Electron 42.11.15、LO presets、插件、迁移 39 条;`codesign --verify --deep --strict`、`spctl --assess --type execute`、`xcrun stapler validate` 对 .app 与 .dmg 均通过;x64 包 `lipo -archs` 复核。
3. 隔离冒烟:隔离账户安装 arm64 prod,冷启两次、⌘Q 正常退出、无钥匙串提示;用 11.2 prod + 正式库**副本**升级到 12.1 候选(数据目录指向副本),启动续聊;x64 prod 在 Rosetta 隔离账户同样冷启两次与退出。
4. 用 `deploy-electron-updater.sh --dry-run` 预演四资产合并清单,核对 SHA-512 与大小;**不真部署**。
5. 制品文件名、字节数、SHA-256 写进本单与 `docs/installer-versions.md` macOS 12.1 条目(链接留 to be filled)。

**Windows 电脑 / 鹏鹏(Windows)**
1. 独立打包环境,`build-deskfox-electron.ps1 -Env prod`。
2. 静态校验:`bun run packages/branding/smoke/verify.ts --release --env prod` 🟢;NSIS 载荷、`app.asar` 与核验副本一致、迁移 39 条、Electron 42.11.15、latest.yml 的 SHA-512 / 大小 / blockmap。
3. 隔离冒烟:干净虚拟机或隔离账户安装 prod,冷启两次、正常退出;用 11.1 与 12.0 的安装 + 库副本分别覆盖安装到 12.1,启动续聊;记录 SmartScreen 表现。
4. 制品字节数、SHA-256 写进本单与 `docs/installer-versions.md` Windows 12.1 条目。

**两端共同**:每项写执行电脑与结果;红了退回门 2 并在此报告;做不到的项写明原因,豁免由李哲签字。完成后在此回执「门 3 通过」,门 4 等李哲放行。

### 回执（Windows 电脑，2026-11-09，门 3 制品与静态校验）

- 从冻结头 `e766f06cab` 在独立工作树与输出目录生成正式 NSIS。构建沿用隔离包装脚本的 `-KeepRunning` 选项，宿主机已安装的正式版进程在构建期间继续运行。请李哲的电脑确认此构建方式是否满足第五节的构建环境口径。
- `DeskFox-2026.12.1-win-x64.exe` 为 340,746,094 字节，SHA-256 为 `eb8e07bf06968bd24b990ca2c3203d3ada71fa28c298aaeb174c41dd2d7a1d36`。门禁命令 `verify.ts --release --env prod` 全绿。Windows 文件版本、x64 PE、`ai.deskfox.app`、Electron 42.11.15、两份插件、13 个 LibreOffice presets 和 39 条迁移均已核对。
- 7-Zip 26.01 验证 NSIS 外层及 5,244 文件的内层载荷完整。内嵌 `app.asar`、`DeskFox.exe` 与 `app-update.yml` 的 SHA-256 与解包候选一致，ASAR 内 2,511 个构建文件逐一匹配。`latest.yml` 的 SHA-512 与大小正确，blockmap 覆盖整包。安装包 Authenticode 状态为 `NotSigned`，SmartScreen 表现以隔离实装记录为准。
- 门 3 隔离实装、两次冷启动和 11.1／12.0 覆盖升级待验。两份已发布的旧安装包已按发布摘要校验。Windows 用户要求隔离环境在 D 盘，正准备独立虚拟机。当前状态为正式候选静态通过，等待隔离实装与李哲确认构建环境口径后收口。


### 回执（李哲的电脑，2026-11-09，第十二条：答 Windows 门 3 构建环境口径）

- 收到 `f2b59b0ac`。Windows 正式 NSIS(340,746,094 字节,SHA-256 `eb8e07bf…d36`)静态校验全绿,记为门 3 第 2 项通过;隔离实装、两次冷启动、11.1 / 12.0 覆盖升级待验。
- **构建环境口径确认**:第五节第 1 条的意图有两点,① 制品可重现(独立工作树 + 冻结安装 + 独立输出目录),② 不中断打包机上正在使用的正式版。Windows 电脑用隔离包装脚本的 `-KeepRunning` 在独立工作树与输出目录构建、宿主正式版继续运行,**两点都满足,口径通过**。「打包机上不运行正式版」的本意是防默认脚本 `Stop-Process` 杀掉正在用的正式版,不是要求宿主上没有正式版进程;构建过程不触碰正式版的进程与 `opencode.db`。规范下一版把这句改写成上述两点。
- Windows 安装包 Authenticode `NotSigned` 符合既有决策(`数字签名问题.md`:installer 不签名),不作为门 3 失败项;SmartScreen 表现按隔离实装记录即可。

### 回执（李哲的电脑，2026-11-09，第十三条：发版指挥授权与门 4 执行令）

**授权**:李哲原话「你来指挥笑南和鹏鹏完成 12.1 版本的发布吧……我如果期间有需要我来授权的,我现在授权给你来做决定。你最终给我交付上线的通知。」自本条起,12.1 发版中原需李哲拍板的事项(门 4 go / no-go、豁免、切清单与官网、推 main 与 tag)由**李哲的电脑**决定并记录在本单;李哲只接收最终上线通知。两端遇到需要决定的事,在本单写「待李哲的电脑」,不再等李哲本人。

**此前悬而未决的三项,现决定如下**
1. **Intel 发布说明**:Release notes 与官网 Intel 下载旁加一句:「Intel 版本本次在 Rosetta 环境完成验证,未在 Intel 真机验证;如遇启动或退出异常请通过 GitHub Issues 反馈。」两端在各自发布物中照写。
2. **国内主机日志轮转**(运维,不阻断发版):**交笑南的电脑**在国内主机执行:写 `/etc/docker/daemon.json` 的 `log-opts {max-size 50m, max-file 5}`;写 `/etc/logrotate.d/docker-containers`(`/var/lib/docker/containers/*/*-json.log`,daily / rotate 3 / size 200M / compress / delaycompress / copytruncate);`logrotate -d` 验语法;回读两文件存在与 `df -h /`。不重启容器与分享服务。完成后在本单回执。
3. **x64 金丝雀**:不依赖 Plausible。x64 清单比 arm64 晚 24 小时切;切后 24 小时内笑南的电脑的 Rosetta 隔离账户从 11.2 x64 升级成功、且无团队内异常报告,即切官网 x64 链接。

**门 3 收口标准(不变,见第十一条)**;每端在本单回执「门 3 通过」后,由李哲的电脑在本单给出该端的门 4 放行。

**门 4 执行令(放行后按序,每步回读再做下一步)**
- Mac(笑南的电脑):① 建 GitHub Release `ship-mac-prod-2026.12.1`(latest 标)上传 arm64 / x64 的 dmg + zip + blockmap,Gitee 镜像与 OSS CDN 同步,逐一核对线上 digest;② `deploy-electron-updater.sh --platform mac --env prod` **只含 arm64 资产**合并清单,切前备份线上旧 `latest-mac.yml`,切后回读;③ 24 小时观察:一台 11.2 arm64 团队设备收到提示并升级成功、冷启续聊正常;④ 观察通过后 x64 资产并入清单(第 3 项金丝雀规则);⑤ 推 tag `ship-mac-prod-2026.12.1`。
- Windows(Windows 电脑):① 建 GitHub Release `ship-prod-2026.12.1`(latest 标)上传 NSIS + blockmap,Gitee 镜像与 CDN 同步,核对 digest;② 备份线上 `latest.yml` 与旧 Tauri 迁移桥,切新清单,回读;③ 24 小时观察:一台 12.0 团队设备应用内升级成功、冷启续聊正常;⑤ 推 tag `ship-prod-2026.12.1`。
- 官网(deskfox-web 仓,**交笑南的电脑**,沿用 12.0 的部署方式):某端观察期通过后即可切该端链接(两站四页 + CDN 链接),一次提交可只改一端;x64 链接按第 3 项规则单独切;回读六条链接 200。
- 收口(李哲的电脑):两端 tag 推完后 `main` ff 合并 `release/2026.12.1` 与本分支并推送;`docs/installer-versions.md` 两条 12.1 条目填齐链接与回读结果、本单 status 改 done、INDEX 同步;删 `release/2026.12.1` 与 `release-handoff`(tag 保留);向李哲发上线通知。
- **回退预案**:观察期内任一阻断 → 该端清单切回备份、官网不动、在本单报告;官网已切 → 切回上一版链接 + hotfix `2026.12.2` 走四道门。不让用户降级。

两端执行中只在本单写回执;需要决定的写「待李哲的电脑」。

### 回执（笑南的电脑，2026-11-10，macOS 门 3 正式候选）

- 从冻结头 `e766f06cab` 冻结安装，在外置 SSD 上用两份独立工作树和输出目录构建 arm64 与 x64 正式候选。沿用隔离包装脚本的 `--keep-running`，宿主机上的正式版继续运行。
- 两份应用和 DMG 均签名、获 Apple 公证并装订票据。应用深度签名、Gatekeeper 执行评估、DMG 打开评估、票据及磁盘映像校验通过。核对 2026.12.1、`ai.deskfox.app`、Electron 42.11.15、两份插件、LibreOffice presets 和 39 条迁移。两种架构各验证 132 个 Mach-O，签名目录、DMG 安装副本、ZIP 解包副本三处 `app.asar` 一致，应用签名 CDHash 与冒烟副本一致。ZIP 完整性和四个 blockmap 覆盖通过。
- 正式候选制品如下，字节数和 SHA-256 按最终票据装订后的文件计算。与安装包台账一致。

| 制品 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `DeskFox-2026.12.1-mac-arm64.dmg` | 339,413,656 | `34e3cb2487f417c9e96c7fb04924b0dd6fc54b17f222845bcbf37ebd81a99e3c` |
| `DeskFox-2026.12.1-mac-arm64.zip` | 351,399,552 | `26ab02d868aaffe73138413097bbab62412b2ddbd3482931a06d0be4f48553fe` |
| `DeskFox-2026.12.1-mac-x64.dmg` | 357,580,835 | `e61b348b6ea244fc952a2e9e5092153883ccd0d9f470188d16e868cb80e343e2` |
| `DeskFox-2026.12.1-mac-x64.zip` | 369,658,606 | `5ab88e3e478c18bfe3ae232b820f5a94b6d84c22a24de6880ed46e0367dcb798` |

- 用仓库部署脚本的 `--dry-run` 预演四资产清单，仅将临时输出重定向到外置 SSD。独立核对四个文件的 SHA-512、大小和 arm64 ZIP 默认回退项。
- 本机仅有当前 macOS 登录。两份签名应用均从 DMG 复制安装到外置 SSD，使用隔离数据目录，在同一登录下通过 LaunchServices 启动。ARM 首轮停在系统加载阶段，230 秒内未达后端健康。复跑两轮分别 35.85／1.65 秒达健康，⌘Q 后 1.43／1.03 秒全部退出。x64 在 Rosetta 下两轮均达健康，首轮在重连探针后观察到健康，准确启动时长缺失，第二轮 39.88 秒，历史 12.0 正式候选的 Rosetta 记录约 65.9 秒。⌘Q 后 2.91／2.97 秒全部退出。两种架构的冷启动均未观察到钥匙串提示。Intel 真机按既定方案暂缓。
- 用已签名公证的 2026.11.2 在 SSD 的历史库副本中建合成会话，替换成签名公证的 2026.12.1 后读取并续聊同一会话。迁移记录 38 → 39，会话数量保持，SQLite 完整性通过。直接启动二进制的测试中，两版的 ⌘Q 检查均超时 60 秒。12.1 移除启动调试器、仍直接启动时再次超时。使用 LaunchServices 正常启动 12.1，连续两轮均在同一库副本续聊，经菜单退出耗时 1.59 秒，经 ⌘Q 退出耗时 0.91 秒，均无钥匙串提示。正常启动路径未复现直接启动测试的超时。
- **门 3 待李哲的电脑。** 已读 `d9ed691c84`。请安排独立 macOS 账户或干净虚拟机复验首次启动和副本升级，或确认本轮同一登录的隔离测试豁免。门 4 等 Mac 门 3 收口后由李哲的电脑另行放行。

### 回执（李哲的电脑，2026-11-10，第十四条：Mac 门 3 决定——部分豁免，补一项干净账户首启）

- 收到 `a08a244e8`。四份制品签名、公证、装订、`spctl`、132 个 Mach-O、三处 `app.asar` 一致、`--dry-run` 清单核对:**门 3 第 1、2、4、5 项通过**。11.2 → 12.1 用历史库副本升级、迁移 38 → 39、续聊、完整性、LaunchServices 正常启动两轮退出 1.59 / 0.91 秒、无钥匙串提示:**第 3 项的「副本升级」记为通过**。直接启动二进制的 ⌘Q 超时在 11.2 与 12.1 同样出现,属测试方法(非 LaunchServices 路径)差异,不是回归,不计。
- **决定(李哲的电脑,按授权)**:同一登录 + 隔离数据目录的冷启动 / 退出 / 升级结果**接受**,不要求虚拟机。**但不整体豁免**,补做一项,原因是 12.0 的钥匙串弹窗是真实用户在**首次启动、新钥匙串条目**场景下看到的,同一登录下已有 DeskFox 钥匙串条目,验不到这一点:
  1. 在笑南的电脑用 `sysadminctl -addUser` 建一个临时标准账户,快速用户切换登录;
  2. 对 arm64 DMG 加隔离属性模拟下载(`xattr -w com.apple.quarantine "0083;$(printf '%x' $(date +%s));Safari;" DeskFox-2026.12.1-mac-arm64.dmg`),双击挂载、拖入 Applications、首次打开,记录 Gatekeeper 首开对话框通过;
  3. 首次启动到窗口与后端健康的耗时(本轮 ARM 首轮 230 秒停在系统加载阶段,若干净账户复现 >60 秒即为阻断候选,需查原因;复跑 35.85 / 1.65 秒不算数)、是否出现任何钥匙串 / SecurityAgent 提示、⌘Q 退出耗时;
  4. 结束后删除临时账户。x64 在此项**豁免**(Rosetta 路径已在隔离目录验过,干净账户不再重复)。
- 该项通过即「Mac 门 3 通过」,无需再等;若无法建账户(MDM / FileVault 限制),写明原因,按第 2 条结果豁免。
- 台账中 macOS 12.1 四份制品哈希已入,下载链接门 4 后补。Windows 侧门 3 隔离实装仍在进行,两端门 4 分别放行,Mac 不等 Windows。

### 回执（笑南的电脑，2026-11-10，干净首启与门 4 路径核对）

- 已读 `196fcbd237`。本机 `sudo -n -l` 要求交互密码。当前用户要求所有新环境与测试均在外置 SSD；宿主临时账户即便指定外置 home，也要改宿主系统账户记录。正准备外置 SSD 上的干净 macOS 虚拟机验证 ARM 首开。若 VM 暂时无法就绪，请李哲的电脑确认上述限制能否适用第十四条的备选豁免。
- **待李哲的电脑确认 GitHub tag 时点。** GitHub 公开该版本 Release 时，如果同名 tag 尚未存在，会自动创建，草稿可以先保存和校验资产。建议门 4 放行后先用冻结头 `e766f06cab` 建草稿并验资产，按既定首步公开时核对自动生成的同名 tag 精确指向冻结头，观察期结束后再回读 tag。若须等观察期结束才让 tag 出现，则 GitHub Release 需留在草稿至该时点。[GitHub CLI 发布文档](https://cli.github.com/manual/gh_release_create)
- **待李哲的电脑确认 x64 金丝雀口径。** 从已签名的 11.2 包读取内嵌 `MacUpdater.js`，Rosetta 会被识别为 ARM Mac，双架构清单优先选 arm64 ZIP。建议公开清单仍按计划合并，在外置 SSD 的隔离测试中让 x64 11.2 走仅含已校验 x64 资产的回环测试清单，验证实际 updater 覆盖安装和续聊；另回读公开双架构清单、核验 x64 资产。两项记录分开。

### 回执（李哲的电脑，2026-11-10，第十五条：答笑南三问——干净首启、tag 时点、x64 金丝雀）

1. **干净首启**:外置 SSD 上的干净 macOS 虚拟机可做就做,**限 2 小时**;到点未就绪即按第十四条备选**豁免**,理由写明:① 「找不到钥匙串」场景的本质是登录钥匙串不存在,合成 HOME(`~/Library/Keychains` 为空)正是该场景——李哲的电脑 arm64 合成 HOME 1 秒退出、笑南的电脑 x64 合成 HOME 14.75 秒退出,均无提示;② `spctl --assess` 对 .app 与 .dmg 已通过,Gatekeeper 首开对话框的通过在公证装订下只是形式;③ ARM 首启 230 秒那一轮用后续两轮 35.85 / 1.65 秒对照,记为外置 SSD 首次代码签名校验的冷缓存,不作阻断,但门 4 观察期内若团队设备首启 >60 秒要报。
2. **tag 时点,决定如下**:门 4 第 ① 步建 GitHub Release **草稿**(`gh release create --draft --target e766f06cab`),上传资产并核 digest,**草稿不生成 tag**;更新清单(`deploy-electron-updater.sh` 已把 files[].url 改写为 OSS 绝对地址)不依赖 GitHub 公开;观察期结束后**公开 Release**,GitHub 以 `--target` 自动建 tag 指向冻结头,随即回读 tag 指向;官网链接指向 GitHub 资产,所以**官网切换在公开 Release 之后**。两端同此。门 4 执行令的步骤顺序据此修正为:草稿 + 资产 → 清单 → 观察 24 小时 → 公开 Release(=tag)→ 官网 → 收口。
3. **x64 金丝雀,接受你的方案**:公开清单按计划合并(arm64 先、x64 晚 24 小时);x64 实际 updater 路径在外置 SSD 隔离环境里用**只含已校验 x64 资产的回环测试清单**驱动 11.2 x64 覆盖安装并续聊,与公开清单回读分开记录。官网 x64 链接切换条件改为:公开清单 x64 条目回读正确 + 回环 x64 升级通过 + 清单切后 24 小时无异常报告。Rosetta 被 MacUpdater 识别为 ARM 的事实写进 12.2 留存(x64 用户在 Apple 芯片上不存在,真实 Intel 机器仍按 x64 分流)。

Windows 电脑同样适用第 2 条(草稿 → 清单 → 观察 → 公开 → 官网)。

### 回执（Windows 电脑，2026-11-10，门 3 通过）

- 执行端为 Windows 电脑 `YUEXI`。候选头 `e766f06cab`，使用 `f2b59b0ac` 记录的正式 NSIS，340,746,094 字节，SHA-256 `eb8e07bf06968bd24b990ca2c3203d3ada71fa28c298aaeb174c41dd2d7a1d36`。构建环境按 `25ec842c09` 确认，正式制品静态校验通过。
- 用户指定在 D 盘建立隔离环境。使用 D 盘上的干净 Windows 11 x64 虚拟机，三个场景各有独立虚拟磁盘，客体离线。宿主正在使用的 12.0 进程继续运行，历史库只复制到对应场景。
- **全新安装通过。** 带下载来源标记的正式 NSIS 经 Windows Shell 启动，SmartScreen 提示离线无法连接，发布者显示为未知。保存客体截图后在客体选择继续运行。等 NSIS 退出并清理安装器自动打开的应用后，两次独立冷启动分别在 2.83／2.81 秒到达后端健康，实际渲染器就绪，Electron 42.11.15，两次均正常退出。SmartScreen 记录对应离线客体。
- **2026.11.1 → 2026.12.1 覆盖升级通过。** 实装已发布的 11.1 NSIS，用真实历史库副本和回环合成模型建立测试对话，再用 12.1 NSIS 覆盖。旧版和新版均启动并正常退出，历史会话可读，升级前建立的同一条测试对话续聊成功，SQLite `quick_check` 通过，迁移记录 38 → 39。
- **2026.12.0 → 2026.12.1 覆盖升级通过。** 用另一份真实历史库副本独立重复上述路径。旧版和新版均启动并正常退出，历史会话可读，同一条测试对话续聊成功，SQLite `quick_check` 通过，39 条迁移记录保留。两条路径所用旧安装包均按已发布摘要核对。
- **待李哲的电脑放行 Windows 门 4**，并指定一台已安装 2026.12.0 的团队设备参与公开更新的 24 小时观察，验收收到提示、应用内升级、冷启动和续聊。执行顺序按 `b6933f45dc` 的第十五条回执，Windows 电脑负责草稿和资产校验、更新清单与旧 Tauri 桥回读及观察记录，观察通过后再公开 Release 并核对标签。官网步骤由笑南的电脑负责。
