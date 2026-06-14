feat-id: auto-updater-install-silent-fail
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 诊断轨迹(单线程,0 子 agent)

1. 后端链路逐项排查:线上 manifest `.../desktop/darwin/latest.json` 200 / version 2026.7.1;OSS 升级包
   `dl.clawtray.com/DeskFox-2026.7.1-darwin.app.tar.gz` 200 235MB;pubkey `2A008F3DA4940FDE` vs manifest
   签名 keyID 匹配 → **后端全绿**,问题在客户端。
2. `{{target}}` 展开 = `darwin`(非 `darwin-aarch64`),部署路径与 endpoint 一致,路径不匹配假设**排除**。
3. user 澄清:下载成功(toast 弹出显示线上版本)→ 点「安装并重启」无反应 → 锁定 `updateAndRestart` 的
   install/relaunch 阶段。
4. 本机即 user 运行环境:installed `/Applications/DeskFox.app` = 2026.7.0、属主 openclaw 可写、无 translocation。
   - 权限假设**排除**(.app 与 /Applications 都可写)。
   - EXDEV 跨卷假设:实测 GUI app `$TMPDIR`=`/var/folders/...` dev 与 /Applications 同卷 → **排除**。
5. 读 `tauri-plugin-updater-2.9.0/src/updater.rs` macOS `install_inner`:先解压到 tempdir(`path.skip(1)`),
   再两次 `fs::rename`。app 完好停 2026.7.0 → 推断 install 在**解压阶段**就抛错(在 rename 之前)。
6. **最小 Rust 复刻**解压循环跑真实 tarball:`UNPACK FAIL @ entry #0 ._DeskFox.app → EPERM`。根因落地。
7. `COPYFILE_DISABLE=1` 重打包同一 .app → Rust 复刻 3532 entry 全过。修复可验证。
8. python3 看 raw 成员:原版 7064(3532 真 + 3532 `._`),修复版 3532 / 0 `._`。确认 bsdtar 隐藏了 `._`。

## 修复策略(两层 + 一项待授权)

- **根因层(build)**:`build-deskfox.sh` 2.6 段 `tar -czf` 前加 `COPYFILE_DISABLE=1`;打包后 python3
  防回归断言(任何 `._` 成员 → 删 tarball+sig + 报错,让后续签名/部署安全失败,绝不发坏包)。
- **纵深防御(client)**:停止吞 `check()`/`download()`/`install()` 错误,让其向上抛;三个调用站点
  (settings-general toast action / layout toast action / error 页已自带)捕获后弹真实错误。后台轮询加
  `.catch(()=>{})` 保持安静避免未处理 rejection。
  - 决策:**本轮不**给 macOS 加 install 前 `killSidecar()`。理由:① macOS 可替换运行中文件,sidecar
    占用极可能非主因(已被根因证伪);② 若提前杀 sidecar 而 install 仍失败,app 后端会挂掉却未重启,
    诊断/体验更糟。根因已是 tarball,无需此项。
- **production 重部署(待 user 授权)**:线上 2026.7.1 tarball 带毒,2026.7.0 用户全部 stranded。需用洁净
  tarball 重打 + 重签(2A00 私钥)+ 重传 OSS + 重部署 `updates.deskfox.ai` manifest。本地已有 2026.7.1
  notarized .app(== 线上),可直接重打 updater 包、无需 full rebuild + 2h 公证。版本策略(重发 2026.7.1
  vs bump 2026.7.2)+ 部署待 user 拍板。

## 待办

- ~~production 重部署 + 真机端到端验证~~ ✅ **2026-06-12 完成**(staple 现有公证票免重审 → COPYFILE_DISABLE 重打
  → minisign 重签 → R9 三验 → 传 OSS + 部署 manifest;踩 CDN 同名缓存陷阱 → 改名 cache-bust `-fix1-`;
  端到端字节 sha256/0-AppleDouble/Rust 解压三验 + user 真机点升级成功。详见 3-changelog)。
- 可选(未做):`verify-updater-artifacts.ts` 加「无 AppleDouble 成员」校验作 ship 前第二道闸(当前靠 build 内断言)。
- 已知约束:同版本号重发 updater 包需 cache-bust 改名(Aliyun CDN 不自动刷新同名;`upload-asset-to-oss.sh` 无刷新逻辑)。
