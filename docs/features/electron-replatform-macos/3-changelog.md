feat-id: electron-replatform-macos
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动日志

## 阶段 0 — 基座验证(无文件改动,纯实测)

确认 Electron 基座在 macOS 可用,端到端全链路通(详见 2-plan.md 决策轨迹):
- `bun install` → `bun run build`(electron-vite)→ `out/` + opencode Node 后端 + wasm 全产出
- `electron-builder --mac` → `DeskFox Dev.app`(444M,身份 `ai.deskfox.app.dev`,app.asar 174MB)
- 启动 → opencode 后端监听 `127.0.0.1:60543`,`curl` 返回 **HTTP 401**(鉴权 = 健康)

## 与远程 dev-independent-version-line 的协作交集(2026-06-14)

阶段1 开发期间,Win 同事并行推送了 `dev-independent-version-line` 系列(远程 commit
`f76b951fbf`/`1a708ebab4` 等),其中**已完成两件本 feat 原计划做的事**:
- **版本号注入**:`electron-builder.deskfox.config.ts` 自读 `installer-versions.json`(按 `--mac/--win`
  argv + channel 选号线,无 flag 回落 `process.platform`)→ `extraMetadata.version`。
  → 本 feat **采用远程方案,放弃自己的 `DESKFOX_APP_VERSION` 环境变量方案**(远程的更自洽)。
- **黑名单豁免**:pre-commit `EXCEPTION_REGEX` 加 `.*\.deskfox\.config\.(ts|js|mjs)$`。
  → 本 feat 改 deskfox config **不再需要 R4 override**(原 R4 计划作废)。

故本 feat 的实际增量收窄为:**构建 wrapper 脚本 + 删 native 死引用 + mac 适配文档**。

## 阶段 1 — 固化 dev 构建脚本(实际增量)

### 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/branding/scripts/build-deskfox-electron.sh` | 新增(fork-only) | macOS Electron 一键构建 wrapper,取代旧 `build-deskfox.sh` 的 mac 职责 |
| `packages/desktop/electron-builder.deskfox.config.ts` | 改(fork-only,黑名单已豁免) | 删 `native/` 死引用(版本注入由远程 dev-independent-version-line 负责,本 feat 不动) |

### build-deskfox-electron.sh 能力

- 参数 `-Env <dev\|beta\|prod>` + `--no-bundle`(→ electron-builder `--dir`,只出 `.app`)
- 预检 `installer-versions.json` 版本 key + 打印(实际注入由 deskfox config 自读)
- 内置两个适配点:`--publish never` + `env -u …_PROXY` 绕 Clash 代理直连 npmmirror
- `ELECTRON_CACHE` 本机外置卷优先(`/Volumes/ExtSSD`,无则回落系统默认,不硬编码以免他机 break)
- 构建前 `pkill DeskFox`(避免 `dist-deskfox` 被运行中的 `.app` 锁)
- 末尾打印产物绝对路径

### config 改动要点

- 删除 `extraResources` 的 `native/` 条目(两分支无源码 + `src/main` 零 import,消除每次构建 2 条 warning)

### 验收结果(R9 分支内验收闸)

- ✅ `bash build-deskfox-electron.sh -Env dev --no-bundle` 一键出 `.app`
- ✅ 版本号注入(远程方案):`CFBundleShortVersionString = CFBundleVersion = 2026.6.0`(非 tauri semver `1.17.4`)
- ✅ 0 条 `file source doesn't exist from=.../native` warning(原每次构建 2 条)
- ✅ 身份 `ai.deskfox.app.dev`
- ✅ `bun run typecheck`(desktop)通过,无 error
- ⏳ 整合远程后需复跑一次构建确认(见下)

### 三个国内/换基座踩坑(阶段0 实测定位,沉淀)

1. **`--publish never` 必加**:否则 electron-builder 拉 `publish.url` 的 `latest.yml` 生成差量
   blockmap,dev channel manifest 未部署时请求挂起 600s 超时。
2. **绕 Clash 代理**:npmmirror 国内镜像须直连,走代理致 electron `SHASUMS256.txt` 校验超时。
3. **`bun.lock` 污染**:本机 `BUN_CONFIG_REGISTRY=npmmirror` 会把镜像 URL 写进 lockfile,**绝不
   commit**(开源仓不污染);install 后 `git checkout bun.lock` 还原。

### 回退方法

- `git revert <commit>`:改动全 fork-only(脚本是新增文件;config 仅删 native 一处),无上游侵入。

## 运行时功能平移补全 + 测试基础设施(2026-06-14)

阶段0/1 跑通构建链后,补齐一批 Tauri→Electron 平移时遗漏的 macOS 运行时功能 + 打包资源,
并修复 desktop 单测基础设施。本批 4 笔 commit:

| commit | 主题 | 改动 |
|---|---|---|
| `11f37b182a` | 测试基础设施 | `bunfig.toml` + `test/electron-mock.ts`:全局 electron mock preload(根因见下) |
| `0da9235870` | HTML 预览右键加聊天 | `local-asset.ts` injectContextmenuBridge(text/html 注入 `__deskfox` 桥接脚本)+ 5 例单测 |
| `653807db07` | 防睡眠持久化+恢复 | `prevent-sleep.ts`(persist/restore/enabledFromStoreValue + 修事件名缺 `deskfox-` 前缀致托盘/设置不同步)+ `store-keys.ts`/`index.ts` + 5 例单测 |
| (本笔) | macOS 内置 LibreOffice 注入 | `electron-builder.deskfox.config.ts`(mac 段注入 LO bundle 到 `Contents/Resources/libreoffice`)+ `build-deskfox-electron.sh`(plugin/LO 资源就绪门槛 + post-build soffice 存在校验) |

### 测试基础设施根因(沉淀)

desktop 多个被测源文件顶层 `import ... from "electron"`(local-asset→protocol、prevent-sleep→
powerSaveBlocker/BrowserWindow、store→default.app)。bun:test 同进程跑全量时,ESM linker 用
**最先加载 electron 的文件**固化其导出名集合,后续文件再 `mock.module("electron")` 也无法新增
名字 → 缺名的 named/default import 直接 link 失败。表现为**单独跑各测试文件全绿、合跑炸**
(`Export named 'powerSaveBlocker'/'protocol' not found` / `Missing 'default' export`),且报错
文件随执行顺序漂移。修法:`bunfig.toml [test].preload` 全局 mock,在任何测试体执行前把 electron
定死成超集 → 对任意执行顺序鲁棒。验收:`bun test src` **81 pass** / 单文件跑亦绿 / typecheck 通过。

### LibreOffice 注入要点

- config mac 段:仅在 `branding/libreoffice-bundle/macos/LibreOffice.app` 存在时注入(否则本地
  无 LO 的自测构建不中断);"发布物必须含健康 LO"的硬门槛由 build 脚本把守(对齐 main §1.9 分层)。
- build 脚本 §3.5:发布物(非 `--no-bundle`)构建前校验 plugin dist + LO bundle 的
  `presets`/`extensions` 齐全(过度剥皮的 LO 必致干净机 "User installation could not be completed",
  历史教训);§5.5 post-build 验证最终 `.app` 内含可执行 soffice(挡"LO 没被 electron-builder 收进最终包")。
- 注:soffice 此处尚未 Developer ID 签名(嵌套 bundle 签名属阶段2,当前 config `identity=null`),
  仅做结构性存在检查;冷启动健康由 `prepare-lo-bundle` 的 smoke 闸保证。

### 门槛精修 + 运行时验证(完整构建实测,2026-06-14)

跑完整 `build-deskfox-electron.sh -Env dev`(出 dmg+zip+app)后独立深验产物,发现并修复门槛盲区:

- **发现**:首次构建 §5.5 post-build 报 ✓,但最终 .app 实际缺 `libreoffice/Contents/Resources/extensions`,
  且 §5.5 只验了 soffice、没验 presets。
- **根因实测**(mac 全新 profile 冷启动转换):
  - `presets/` 是 office 转换【硬依赖】—— 删之转换直接失败(profile 建成但 convert 无输出)。
  - `extensions/` 在 LO bundle 里是【空目录】,electron-builder 打包必丢弃空目录 → 最终 .app 无之;
    但缺它冷启动转换完全正常 → 非硬依赖。**修正了既往"presets/extensions 都是硬依赖"的笼统认知**。
- **修复**(`build-deskfox-electron.sh`):§3.5 presets 改"存在且非空"硬卡、extensions 降警告;
  §5.5 post-build 新增复验最终 .app 的 presets 非空(堵"electron-builder 漏拷 presets → 用户机 office 静默失效")。
- **重建验证**:§5.5 打印"含可执行 soffice + 非空 presets ✓";最终 .app presets 13 文件在位;
  版本 `2026.6.0` / 身份 `ai.deskfox.app.dev`。
- **运行时健康**:启动 .app,opencode 内嵌 Node 后端(utilityProcess `node.mojom.NodeService`)4s 起,
  监听 `127.0.0.1:59811`,`/`·`/app`·`/config`·`/global/health` 全 **HTTP 401**(鉴权=健康)。
- **已知限制**:dev 未签名包的嵌套 soffice 完全未签名 → arm64 直接执行被 SIGKILL(office 转换在 dev 包
  不可用);正式可用须阶段2 Developer ID deep-sign(electron-builder 自动 deep-sign 含嵌套 bundle)。

### 合 main 前全量测试验收 + lock 测试修复(2026-06-15)

合 main 前按 R9 跑全量测试,逐一定根因(详见 memory `reference_local_test_env_false_failures.md`):

- **fork 自有代码 + R9 门控套件全绿**:typecheck 26/26、media-gen 140/0、adapter-feishu-lark 740/0、app 438/0、ui 27/0。
- **opencode 14 个失败 = 纯本地环境**,清代理 / 英文 locale 后全绿、CI 必过(已实证):
  - httpapi-sdk(12)+ lsp interop(1):本地 Clash 代理(`ALL_PROXY=socks5://127.0.0.1:7898`,`NO_PROXY` 盖不住 socks 层)拦截 localhost 测试流量 → `global.health()` 502(`UpstreamError`)+ SSE event stream 30~35s 挂死。清代理重跑 httpapi-sdk 18/18、lsp 12/12,耗时 199s→5.7s。
  - help 快照(1):yargs 跟中文 locale 输出中文(`选项:`/`[布尔]`)vs 英文 `.snap`;`LANG=en_US.UTF-8` 下 1/0 过。
- **core 8 个失败全在上游 effect v2 新核**(fork 只动 28 行、未碰失败文件):5 个 `@ff-labs/fff-bun` native 在 macOS `/private/var` 临时路径 init 失败(上游 v2 全新测试)+ 1 个 watcher `.git/HEAD` FSEvents flaky + **2 个 lock 注释守卫**(本次修复)。
- **结论:无一个失败是 Electron replatform 引入的 regression。**

**lock 测试修复**(本次 commit,Tiny / R4 override):
- 文件:`packages/core/test/tool-write.test.ts` + `tool-edit.test.ts`(各 +1 docstring 期望 +1 FORK marker)。
- 根因:上游把 `src/tool/{write,edit}.ts` 顶部语义 docstring **reworded**(旧"Named project references are read-oriented and deliberately not accepted by mutation tools" → 新"absolute external paths retain mutation capability through external_directory approval"),但配套 lock 测试的期望字符串忘了同步。**`upstream/dev` 自己同样红**(源码 count=0、测试 count=1),是上游自带测试债,fork 忠实 sync 后继承。
- 修法:把两测试的 docstring 期望对齐到上游**实际现存**的 docstring(`"absolute external paths retain mutation capability through a separate\n * external_directory approval before edit approval."`),lock 守卫意图(语义 docstring 可见)完整保留,零运行时影响。
- **R4 override 论证**:断言写在上游 test 文件内部,无法从外部新文件覆盖修正,无 wrapper 路径;改源码加回旧句会让 docstring 自相矛盾、风险更高。两文件均加 FORK marker。
- 验证:tool-write 7/7、tool-edit 10/10;core 全量 8→6 fail(剩 5 fff-bun + 1 watcher flaky,均环境/上游)。
- 回退:`git revert` 本 commit 即恢复上游原状(代价是 lock 测试复红)。

## follow-up(2026-08-12):arch → 产物目录映射写反,致 LO 完整性守卫长期失效

**起因**:mac prod 2026.9.1 发版时 x64 build `EXIT=1`,但产物(dmg/zip/公证)全部正常。

**根因**:`build-deskfox-electron.sh` 顶部 arch 归一化那段,把 electron-builder 的产物目录名写反了 ——
写的是 `arm64→mac` / `x64→mac-x64`,实际规则是:

```
platformPackager.js:  appOutDir = "mac" + getArchSuffix(arch, defaultArch)
builder-util/arch.js: getArchSuffix = arch === defaultArchFromString(defaultArch) ? "" : "-" + Arch[arch]
                      defaultArchFromString(undefined) === Arch.x64
```

我们的 `electron-builder.deskfox.config.ts` 未设 `defaultArch` → 默认 x64 →
**x64 得空后缀 `mac/`、arm64 得 `mac-arm64/`**,与脚本假设正好相反。

**后果是双向的,且 arm64 那侧更危险**:
- **x64**:`ls dist-deskfox/mac-x64/*.app` 找不到 → 命令替换失败 → `set -euo pipefail` **静默终止整个脚本**(EXIT=1,§5.5 一行都没打印,日志里看不出任何错误)→ post-build 的 LibreOffice 完整性守卫**一次都没跑过**。
- **arm64**:落到 `mac/`,那里恰好是**上一次 x64 构建的残留包** → 守卫验的不是本次产物**却报绿**。也就是说 arm64 侧不是"没跑",是"跑了但验错对象",**假绿比不跑更危险**。

这个守卫的职责是「绝不发布不含 LibreOffice 的包」(见上文 LO 剥皮陷阱),失效后没有任何自动闸拦得住"LO 没进包"这类事故。2026.9.1 发版时是靠人工逐项补验双 arch(soffice 可执行 / presets 非空 / 架构匹配)才敢发。

**修法**(`packages/branding/scripts/build-deskfox-electron.sh`):
1. 映射改正为 `arm64→mac-arm64` / `x64→mac`,并把 electron-builder 的推导规则写进注释(注明若将来在 config 里显式设 `mac.defaultArch` 需同步改)。
2. §5.5 post-build 验证**新增架构断言**:读 `Info.plist` 的 `CFBundleExecutable` → `lipo -archs` → 必须包含本次目标架构,否则硬失败并提示"很可能验到了上次构建的残留包"。把"验错对象"从静默假绿变成硬失败。
3. **内置 LibreOffice 也断言架构**一致(x64 包里塞 arm64 的 soffice 会让 Intel 用户 office 转换直接失败,而结构性检查看不出来)。
4. 找不到 .app 时给明确报错,不再靠 `set -e` 静默死。

⚠️ **实现中踩到两个坑**(都已在代码注释里固化):
- **`lipo` 的架构名和 electron-builder 不同**:Intel 是 `x86_64` 不是 `x64`。直接拿 `$ARCH` 比会永远不匹配 → x64 构建每次误报架构不符。故加 `LIPO_ARCH` 映射层。
- **一度想改成"扫 `dist-deskfox/mac*/` 按架构探测"以彻底摆脱映射表,实测更糟**:`dist-deskfox` 下存在 `mac-arm64-restored/` 这类人工残留目录,且 glob 排序里 `-`(0x2D) < `/`(0x2F),`mac-arm64-restored/` 会排在 `mac-arm64/` **前面** → 模糊扫描反而优先撞上 8 月 7 日的陈旧包,正是要修的那类问题。故保留"只认规范目录 + 强制架构断言"的严格方案。

**测试**(R5,新增 `packages/branding/__tests__/build-electron-arch-outdir.test.ts`,9 用例):
- 断言映射不得再写反(bug 的精确形态)、`LIPO_ARCH` 映射存在、架构断言块存在且是 `exit 1` 硬失败、LO 架构断言存在。
- **另有一条"与上游真实规则对表"**:本机能解析到 `builder-util` 时,直接用它的 `getArchSuffix` 反推期望值与脚本比对 —— electron-builder 哪天改了命名规则这条会红,提示同步更新。
- 已验证测试**真能抓住原 bug**:临时把映射改回旧值 → 9 用例中 4 条变红(含对表那条);还原后 9/9 绿。

**同时修复"守卫写了从不跑"**(`.husky/pre-push`):
`packages/branding` 的测试**既不在 turbo test 任务、也不在 pre-push**,`lo-bundle-strip.test.ts` 头部注释声称的"CI 接入 turbo.json"注册**实际并不存在**。也就是说 LO 剥皮守卫、托盘图标守卫一直是装饰品。本次把 `(cd packages/branding && bun test)` 加入 pre-push backstop —— 发布脚本一旦回归就是"发出去才知道",必须护住。branding 全量 61 pass / 0 fail。

**回退**:`git revert` 本 commit,脚本回到映射写反的状态(x64 继续 EXIT=1、arm64 继续假绿),不影响产物本身。

## 后续(阶段 2/3,见 1-spec.md)

- 阶段 2:签名 + 公证(mac 段接 Developer ID + `@electron/notarize`)—— 已完成
- 阶段 3:`latest-mac.yml` 部署 + 老 Tauri→Electron 升级桥 mac 侧 —— A 链路已完成;**B 链路(迁移桥)2026-08-11 经 user 拍板永久退役**(用户量小,不背历史负担;且该链路事实上早已因 CDN 证书过期而中断)
