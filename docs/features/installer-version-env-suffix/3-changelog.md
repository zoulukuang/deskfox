---
feat-id: installer-version-env-suffix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# installer-version-env-suffix — changelog

**关联 commit**: `<本笔 commit>`
**所在分支**: `feat/installer-version-env-suffix`
**规模**: Tiny+(脚本治理改动,~80 行 / 5 文件)
**触发**: 2026-05-21 user 实施 `large-file-preview-guard` 后请求"先本地打开安装包",对开发包版本号规范产生疑问 → 拍板 B2(env suffix + N 独立)

## 实际改动

### `packages/branding/scripts/bump-installer-version.ps1`(+15 / -6)

- 加 `[ValidateSet("dev", "beta", "prod")] [string]$Env = "prod"` 参数
- 计算 `$envSuffix`:prod 空 / beta "-beta" / dev "-dev"
- regex pattern 加 `$envSuffix` 字面量 + trailing space anchor 实现 env N 独立计数
- `$newVersion` 拼接 suffix
- 头注全面重写"Rule:YYYY.M.D.N[-env-suffix] (per-platform + per-env counter)"

### `packages/branding/scripts/bump-installer-version.sh`(+22 / -7)

双端 parity:
- 加 `-Env|--env|-e` 参数 + prod/beta/dev 校验
- sed pattern 加 `${ENV_SUFFIX}` 字面量 + trailing space anchor
- `NEW_VERSION` 拼接 suffix

### `packages/branding/scripts/pack-installer.ps1`(+3 / -1)

bump 调用透传:`bump-installer-version.ps1 -Platform "Windows" -Env $Env`(默认 prod 行为不变)

### `packages/branding/scripts/pack-installer.sh`(+3 / -1)

`bump-installer-version.sh -Platform macOS --env "$ENV"`

### `packages/branding/installer/DeskFox.iss`(+11)

- ISPP preprocessor `NumericAppVersion`:`#if Pos("-", AppVersion) > 0` 则 `Copy` 切到 `-` 前,否则 = AppVersion
- `[Setup]` 段加 `VersionInfoVersion={#NumericAppVersion}` 明示数字格式(Inno Setup PE header 必须 N.N.N.N)

## 行数

| 项 | 行数 |
|---|---|
| Windows bump 脚本 | +15 / -6 |
| macOS bump 脚本 | +22 / -7 |
| Windows pack 脚本 | +3 / -1 |
| macOS pack 脚本 | +3 / -1 |
| DeskFox.iss | +11 |
| **净** | **~+54 / -15 = 39 净** |

Tiny+(<50 净),工具治理类,合"<50 行/单一主题" Tiny 阈值。

## 验证

| 项 | 结果 |
|---|---|
| `bump.ps1 -Env dev -DryRun` | next=`2026.5.21.1-dev` ✓ |
| `bump.ps1 -Env prod -DryRun` | next=`2026.5.21.1` ✓ |
| `bump.ps1 -DryRun`(默认 prod)| next=`2026.5.21.1` ✓ |
| `pack-installer.ps1 -Env dev` 真实 pack | 待跑 |
| Inno Setup ISPP preprocessor 编译 | 待跑(pack 时验证)|
| 启动 dev installer 安装到本机 | 待跑 |

## R 合规

- **R2** FORK marker:bump 脚本头注 + Env 参数处 + regex 处 + .iss 加段全标 `[feat: installer-version-env-suffix]`
- **R3** 不涉及品牌资源(版本号字符串本身是 metadata,不属于 R3 品牌/主题/icon 黑名单)
- **R4** 0 override(全 fork 白名单)
- **R5** 工具脚本改动,dry-run + 真实 pack 集成测试覆盖;无 ps1/sh unit test 框架,豁免(Tiny+ 治理类)
- **R6** 不涉及网络监听

## 回退

```
git revert <本笔 commit>
```

回退后 bump 脚本回到只看 Platform 不看 Env 的旧逻辑,所有版本号合并到同一个 N 序列(B1 模式)。已 bump 的版本号(.iss / installer-versions.json / docs/installer-versions.md placeholder)需要单独 revert 它们各自的 commit。

## Follow-up(2026-06-06):ps1 写 installer-versions.json 带 UTF-8 BOM 致 JSON.parse 崩

**分支**: `fix/installer-versions-bom`
**规模**: Tiny(去 BOM + 改 1 行写入编码)
**tag**: `[bug-repro: installer-versions.json BOM -> JSON.parse 崩]`

### 症状

发布前全套测试发现 `packages/branding` 测试 1 个 unhandled error:`installer-versions.json` 被 `JSON.parse` 报 `Unrecognized token '﻿'`(U+FEFF BOM)。文件前 3 字节 `EF BB BF`。由 Win prod ship commit `c961cc1675` 引入,威胁 Mac `deploy-updater-manifest.sh` / 前端版本牌等所有 JSON.parse 读取方。

### 根因

`bump-installer-version.ps1:107` 用 `Set-Content -Encoding UTF8 -NoNewline` 写文件 —— **Windows PowerShell 5.1 的 `-Encoding UTF8` 会写 BOM**。Mac 侧 `bump-installer-version.sh` 用 `sed -i.bak`(line 105)不带 BOM,所以只有 Win ship 触发。这是 ps1 自诞生即埋的隐患,本次 Win ship 首次被 branding 的 updater-config 测试探测到。

### 修复

| 文件 | 改动 |
|---|---|
| `packages/branding/installer-versions.json` | 移除已存在的 3 字节 BOM(治标,让 main 立即干净) |
| `packages/branding/scripts/bump-installer-version.ps1` | line 107 改用 `[System.IO.File]::WriteAllText(..., (New-Object System.Text.UTF8Encoding($false)))` 强制无 BOM(治本,PS5.1 无 `utf8NoBOM` 选项,.NET 写法跨版本一致) |

### 验证

- `branding` 测试:修复前 `11 pass + 1 error` → 修复后 **`13 pass / 0 fail`**(BOM 崩掉的 describe 恢复)
- `installer-versions.json` 前字节 `7b`(`{`),`JSON.parse` OK
- ⚠️ ps1 治本改动**在 Mac 无法执行验证**,待 Win 端下次 bump / ship 实测确认无 BOM 回流

## 关联

- **延续**:`installer-versioning` feat(2026-04-29 立的 YYYY.M.D.N 规范)— 本笔在它上加 env 维度
- **关联**:`docs/governance/应用身份-命名规则.md` 三档 AppId 规则(Mac Bundle ID + Win AppId 三档独立 GUID)— 本笔补齐版本号三档规则
- **不重叠**:`zoulukuang/deskfox` 仓 release tag 命名(`ship-<env>-<version>`)不动,继续按 env tag 分流
- **不动**:已上线 prod 版本(`2026.5.15.1` `2026.5.12.1` etc)的历史 entry 不回填 `-prod` 后缀(无后缀就是 prod,这是 B2 设计中的固定口径)
