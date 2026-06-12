feat-id: auto-updater-install-silent-fail
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# auto-updater「安装并重启」点击后静默无反应 — 根因修复

## 现象(user 报,2026-06-12)

DeskFox(macOS,已装 2026.7.0)设置内「检查更新」→ 弹 toast 显示线上版本 2026.7.1 →
点「安装并重启」→ **等很久没有任何反应**,app 仍停在 2026.7.0、未重启、无任何报错。

## 根因(已复现实证,非推测)

updater 升级包 tarball **首条成员是 `._DeskFox.app`** —— macOS BSD `tar` 为 `.app` 生成的
AppleDouble 元数据文件(存扩展属性/资源叉)。`build-deskfox.sh` 2.6 段(LO 重签后用裸
`tar -czf` 重打包,2026-06-06 引入)**未禁用 macOS copyfile**,于是 tarball 含 3532 个
`._` AppleDouble 成员(`tar tzf`/bsdtar 会自动隐藏它们,GNU/Rust tar 看得见)。

Tauri `tauri-plugin-updater` 2.9.0 macOS `install_inner` 解压时对每个 entry 做
`path.iter().skip(1)`(跳过顶层 `DeskFox.app`)。首条 `._DeskFox.app` 只有一个路径段,
`skip(1)` 后折成**空路径** → 试图把一个普通文件 unpack 到临时目录本身 →
`Operation not permitted (EPERM)` → 解压第 0 步即 `return Err` → `install()` 失败。
该失败发生在动 `/Applications/DeskFox.app` 的两个 `fs::rename` 之前,所以旧 app 完好无损。

而客户端 `updateAndRestart`(desktop/src/index.tsx)用 `.catch(() => false)` + `if(!installed) return`
**把 install 错误整个吞掉**:不报错、不弹 toast、不重启 → 用户视角就是「点了没反应」。

线上 2026.7.1 那份 tarball 与本地构建产物字节相同,**同样带毒** → 所有 2026.7.0 用户点升级都会中招。

## 验收标准

- [x] Rust 复刻 `install_inner` 解压逻辑,原 tarball 必现 `._DeskFox.app` EPERM,`COPYFILE_DISABLE=1`
      重打包后 3532 entry 全解压成功(已验,见 3-changelog)。
- [x] `build-deskfox.sh` 2.6 段加 `COPYFILE_DISABLE=1` + python3 防回归断言(检测到任何 `._` 成员即删毒产物 + 报错)。
- [x] 客户端不再吞 check/download/install 错误,失败时弹 toast 展示真实原因(三个调用站点)。
- [ ] 线上 2026.7.1 updater 包重新打洁净 tarball + 重签 + 重部署(production,需 user 授权,见 2-plan)。
- [ ] 真机端到端:2026.7.0 点升级 → 成功安装 + 重启进 2026.7.1。

## 范围/分级

Small。1 build 脚本 + 3 前端文件(全 fork 自有 / FORK marker),不改上游。production 重部署单列待授权。
