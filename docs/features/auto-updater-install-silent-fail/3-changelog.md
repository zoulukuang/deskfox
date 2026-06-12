feat-id: auto-updater-install-silent-fail
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实际改动

## 根因(一句话)

macOS updater tarball 被 BSD `tar` 塞进 AppleDouble `._DeskFox.app` 等 3532 个 `._` 成员;Tauri
`install_inner` 的 `path.skip(1)` 把首条 `._DeskFox.app` 折成空路径 → 把文件 unpack 到临时目录 → EPERM
→ install 解压第 0 步即抛错;客户端又把错误 `.catch(()=>false)` 吞掉 → 用户「点了没反应」。

## 复现实证

最小 Rust 程序复刻 `tauri-plugin-updater` 2.9.0 `install_inner` 解压循环
(`tar::Archive` 默认 + `entry.path().iter().skip(1)` + `entry.unpack`),跑真实 235MB tarball:

| tarball | 结果 |
|---|---|
| 线上同款(裸 `tar -czf`) | ❌ `UNPACK FAIL @ entry #0 ._DeskFox.app` → `PermissionDenied / Operation not permitted` |
| `COPYFILE_DISABLE=1` 重打 | ✅ `OK -- extracted 3532 entries, no failure` |

python3 `tarfile` 看 raw 成员:原版 7064(3532 真 + 3532 `._`),修复版 3532 / 0 个 `._`。
(`tar tzf`/bsdtar 自动隐藏 `._`,故肉眼/grep 看不到,必须用 Rust tar 或 python tarfile 才暴露。)

## 改动文件(4 个,全 fork 自有 / 带 FORK marker,0 改上游产品逻辑)

### 1. `packages/branding/scripts/build-deskfox.sh`(根因修复 + 防回归)
- 2.6 段 updater tarball 打包:`tar -czf` → `COPYFILE_DISABLE=1 tar -czf`,禁止 macOS 写 AppleDouble。
- 打包后加 python3 防回归断言:检测 tarball 任何 `._` 成员 → 删 `$TARBALL` + `.sig` + 报错,
  使后续签名/部署拿不到产物而安全失败(绝不把坏升级包发出去)。

### 2. `packages/desktop/src/index.tsx`(纵深防御:停止吞错)
- `checkUpdate`:去掉 `check().catch(()=>null)` 与 `download().catch(()=>false)` 两处吞错 →
  网络/验签/下载失败如实抛出(原行为会误报「已是最新版」)。
- `updateAndRestart`:去掉 `install().catch(()=>false)` + `if(!installed) return` →
  install/relaunch 失败如实抛出,交调用方展示真实原因。

### 3. `packages/app/src/components/settings-general.tsx`(调用方捕获)
- 「安装并重启」toast action 的 `onClick` 包 try/catch → 失败弹 `common.requestFailed` + 真实 message。

### 4. `packages/app/src/pages/layout.tsx`(调用方捕获 + 后台静默)
- 启动轮询弹出的「安装并重启」toast action 同样 try/catch 弹真实错误。
- `pollUpdate` 链尾加 `.catch(()=>{})`:checkUpdate 现在会抛错,后台轮询保持安静避免每 10min 未处理 rejection。

注:`packages/app/src/pages/error.tsx` 的 `installUpdate` 早已 `.catch` 展示 `actionError`,无需改。

## 验证

- 根因复现 + 修复有效性:Rust 复刻程序双向验证(见上表)。
- `bun run typecheck`:16/16 通过。
- 防回归断言:python3 对修复版 tarball 报 0 个 `._`,对原版报 3532。

## commit

- `63c35840bb` fix(updater): 代码修复(build 脚本 + 客户端)[bug-repro: auto-updater 安装/检查静默失败]
- `8d050f2a25` Merge → main(`--no-ff`),已 push origin

## 影响范围

- 改 build 脚本只影响 macOS prod/beta updater tarball 打包(Win 走 zip/NSIS、无 AppleDouble,不受影响)。
- 客户端改动:更新失败时从「静默」变「弹错误 toast」;成功路径不变。

## 回退方法

`git revert <commit>`(4 文件均独立可逆,无 DB/迁移/外部状态)。

## 线上重发(2026-06-12 ✅ 已完成 + 真机验收通过)

user 授权后执行,**全程未找苹果重新公证**:
1. `xcrun stapler staple DeskFox.app` —— 用现有公证记录贴票(不重审),`spctl` = Notarized accepted。
2. `COPYFILE_DISABLE=1 tar` 重打 → 3533 成员 / 0 AppleDouble。
3. minisign 重签(2A00 prod 私钥,`source ~/.deskfox-signing/config.env`)。
4. R9 三验:python3(0 AppleDouble)+ Rust 复刻 install_inner(3533 entry 解压 OK)+
   `verify-updater-artifacts.ts --env prod --target darwin` 8 pass(Ed25519 对字节验签)。
5. 传 OSS + 部署 manifest 到 `updates.deskfox.ai`。

**🪤 CDN 同名缓存陷阱(踩到 + 解决)**:第一轮按原名覆盖上传,Aliyun CDN(dl.clawtray.com)边缘仍
`X-Cache: HIT` 吐旧带毒字节(Content-Length 还是 235606072)→ 新 manifest 配旧字节会**验签失配**。
`upload-asset-to-oss.sh` 无自动 CDN 刷新。**解法 = 改文件名 cache-bust**:新对象名
`DeskFox-2026.7.1-fix1-darwin.app.tar.gz`(CDN 必 miss 回源取洁净;`.sig` 对字节签名、与文件名无关仍有效)
+ manifest 指向新 URL 重部署。

**端到端验证(下载线上实际字节核对)**:Content-Length=235467371(洁净)/ sha256
`f13980b0c8a42ea428f831851532c4f118237689b2e5f2152760479b1e3d86a6` == 本地基准 / 0 AppleDouble /
Rust 复刻解压 3533 entry 全过。**真机:user 在 2026.7.0 点「安装并重启」升级成功(TC-3 端到端首次跑通)。**

> 对未来提醒:同版本号重发 updater 包必须 cache-bust 改名(CDN 不自动刷新同名);新版本号天然新名无此问题。
> 下次发版 updater tarball 已由 build-deskfox.sh 的 `COPYFILE_DISABLE=1` + python3 防回归断言根治。
