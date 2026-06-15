feat-id: dev-feishu-binding-missing
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 诊断轨迹 + 修复计划

## 诊断轨迹(逐层取证)

1. **数据在不在** → `~/.opencode/feishu-config.json` 存在,3 账号全 `enabled:true`(InveM🐼/灵狐🦊/FoxPlan)。排除数据丢失。
2. **路径是否隔离** → `account-store.ts` 写死 `join(homedir(), ".opencode", "feishu-config.json")`,无 env/渠道 override;`sidecar.ts prepareSidecarEnv` 不改 HOME → 后端 `os.homedir()` = 真实 home。排除身份隔离。
3. **插件在不在包里** → dev `.app` 含 `Resources/plugin/feishu-bridge/dist/plugin.js`。排除"没打进去"。
4. **server 活没活** → `feishu-plugin-server.json` 指向 port 60387,但 `lsof` 显示**无监听** → server 已死(那是正式版 Tauri+Bun 早上写的)。
5. **dev 这次为何没起** → 最新会话 `server.log`:`[media-gen] ... ReferenceError: Bun is not defined`;包内 `feishu-bridge/dist/plugin.js` 含 `Bun.serve` × 1。
6. **源码 vs 产物** → `node-serve.ts`/`server.ts`(6/14)已用 `node:http`/`serveFetch` 替换 `Bun.serve`;但 bundled dist 是 6/9 旧产物 → **陈旧 dist 是真凶**。
7. **构建为何混入陈旧** → `build-deskfox-electron.sh` §3.5a 只检查 dist 存在、不重建。

## 修复计划(user 拍板 1+2 一起做)

### 1. 重建插件 dist
- `build-feishu-plugin.sh`(`--target=node`,时间戳判断:src 6/14 > dist 6/9 → 触发 rebuild)
- `build-media-gen-plugin.sh`(`bun run build` 总重建)
- 验证:新 dist `Bun.serve` = 0。

### 2. 根治构建脚本(防复发)
`build-deskfox-electron.sh` §3.5a:把"只检查存在"改成"打包前先调两 build 脚本重建" + **post-build Bun 守卫**(grep bundle 残留 `Bun.serve` → 直接 fail,带源码适配提示)。
- 守卫即本次的**回归防线**:今后任何源码未适配 / 构建目标错导致 dist 残留 Bun API,打包阶段即拦下,不会再静默发出"插件起不来"的包。

## 决策

- **不改 plugin-install / server.json 机制**:根因是产物陈旧,不是机制错;最小修复面。
- **守卫只卡 `Bun.serve`**(最致命、本次实锤),不泛卡所有 `Bun.*`(避免误伤注释/字符串;源码已确认生产代码无 Bun 直调)。
- **重建对 `--no-bundle` 自测也生效**:自测包同样含插件、必须新鲜(正是本次场景)。

## 风险与回退

- 改动仅 1 个 fork-only 构建脚本;插件 dist 是 gitignored 现场产物不入仓。`git revert` 单笔回退脚本即可(回退后退回"只检查存在"老行为)。
