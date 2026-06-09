---
feat-id: dev-independent-version-line
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# dev-independent-version-line — spec

## 需求

DEV 预览版的版本号要从稳定版**独立出来**,两条号线解耦、互不耦合(user 2026-06-09 拍板)。

**起源**:审查 `pack-preview-dev.sh` 工作流时发现 `installer-versions.json` 每个平台只有一个版本号,prod 与 dev **共用同一个数字**,区别只在文件名前缀 / updater 渠道路径 / identifier —— dev 的版本号被 prod 绑死,做不到独立演进。

## 决策(user 拍板)

1. **Dev 领先模式**(2026-06-09,二选一中选定):dev 跑在 prod 前的功能波,数字天然更大;新功能先进 dev 预览(`--bump minor` 领先到下一波),稳定后 prod 才追上同一波次。读起来「dev 号 ≥ prod 号,大号=更新的预览」,同 Chrome / VSCode Insiders 惯例。两条线独立计数、独立 bump、互不触动。
2. **格式不变**:仍 `YYYY.次.补` 纯数字 3 段(Mac `CFBundleShortVersionString` 不接受连字符 + updater prerelease 排序问题,见规范 §3.5 —— 故**不加 `-dev` 后缀**)。渠道身份继续靠文件名前缀 `DeskFox-Dev-` / updater 路径 `desktop-dev/` / identifier `.dev` 区分(已有)。

## 架构选型

**数据结构:扁平复合 key**(`dev-<plat>`)而非嵌套 `dev.<plat>`。理由:
- prod 读取(`.macos`/`.windows`)**零改动、零风险**;
- `bump` 脚本用 `grep/sed` 直接改 JSON(为保留格式不走 parser),扁平复合 key 与裸 key **不互撞**(`"macos"` 不匹配 `"dev-macos"`,后者 `macos` 前是 `-` 非 `"`);嵌套会让 sed 的 `"macos"` 在 prod/dev 两行都命中。
- Win/Mac 工具链改动面最小。

权威规则落 [`docs/governance/版本号与发布渠道规范.md`](../../governance/版本号与发布渠道规范.md) §3.2bis / §3.5 / §4.2。
