feat-id: dmg-recreate-sign-fix
status: done
related: ./3-changelog.md

# 3-changelog — 重建的 DMG 未签名,公证后 spctl 判 "no usable signature"

## 规模

Tiny(recreate-dmg 后补 3 行 codesign + 注释,1 文件)。fork-only build 脚本,0 改上游,0 R4。

## 背景 / 复现

承接 [dmg-recreate-mktemp-clobber-fix]:修了 mktemp 占位文件 bug 后,DMG 重建跑通、公证 Accepted、staple 成功,但发版门禁仍卡:

```
xcrun stapler validate <dmg>   → The validate action worked!   (ticket 在)
spctl -a -t open --context context:primary-signature <dmg>  → rejected, source=no usable signature
```

**根因**:`build-deskfox.sh` step 5 recreate-dmg 用 `hdiutil convert` 重建 dmg(为做 DeskFox 左/Applications 右的 Finder 布局),产物**未签名**;脚本 3.6 公证块的注释假设"Tauri 已签好 .dmg",但重建已把 Tauri 签名 dmg 替换成未签名的。于是公证提交的是未签名 dmg → apple 仍 Accept(只校验内部 .app 签名)→ staple → 但 dmg 外壳无 code signature → `spctl -t open` 判 no usable signature → 用户下载双击**挂载** dmg 那步会被 Gatekeeper 拦(需右键打开)。

验证:`codesign -dvv <dmg>` = "code object is not signed at all";dmg 内 `.app` 则 = `accepted, source=Notarized Developer ID`(.app 本身公证完好)。**公证后再补签 dmg 会改 hash 废掉 staple**(实测变 `Unnotarized Developer ID`)→ 顺序必须「签 dmg → 公证 → staple」。

引入点:同 [dmg-recreate-mktemp-clobber-fix],recreate-dmg 是最近 "proper DMG layout"(`0b756753b`/`f1e86410d`)新增,2026.6.4.1 是首次走这条路径(2026.6.3.1 在它之前,用 Tauri 原生签名 dmg)。

## 改动

| 文件 | 改动 |
|---|---|
| `packages/branding/scripts/build-deskfox.sh` | recreate-dmg 的 `hdiutil convert` 之后、3.6 公证块之前,加 `codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$OLD_DMG"` 给重建 dmg 补签 Developer ID。带注释说明签名/公证/staple 顺序铁律。 |

## 验证

- `bash -n` 语法通过。
- 修复后完整 ship 重跑验证:重建 dmg 已签名 → 公证 Accepted → staple → `spctl -a -t open --context context:primary-signature` 应判 `accepted / Notarized Developer ID`(本次 ship 实跑确认)。

## 影响范围

- 仅 macOS prod DMG 外壳签名。.app 与内容签名/公证不变。Win 不产 dmg,无 parity。

## 回退

`git revert` 本 commit。
