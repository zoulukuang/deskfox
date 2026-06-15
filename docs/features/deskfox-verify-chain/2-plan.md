feat-id: deskfox-verify-chain
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 实施计划 + 决策轨迹

## 实施顺序(三笔 commit)

1. **`c2e30bf20`** — 冷启动健康脚本自包含入仓 + 修 conn-refused 误报
   - 接 `OPENCODE-PLAN/诊断工具/cold-start-health-check.py` 复制进 `packages/branding/smoke/cold-start.py`(L1 用,不依赖 sibling repo)。
   - 修其已知 conn-refused 误报(OPENCODE-PLAN 需求池同名 ticket)。
2. **`763c1eac4`** — verify 链编排器 L0/L1/L2/L3 落地(`packages/branding/smoke/verify.ts`)。
3. **`faac87b19`** — 验收铁律入规范(`自动化测试规范.md` R9 callout + 修订记录 v7)。

(以上三笔由先行会话提交,经 `368155e93` 合入 main;本三文档为事后补齐。)

## 关键决策

- **不抽象、用现成零件编排**:typecheck/oxlint/`smoke.py`/`cold-start.py`/`build-deskfox-electron` 产物校验都已存在,verify 链只做「串起来 + 单一判定 + 按改动选层」,不重写底层。符合元原则(稳定 > 简洁,避免业务扩大)。
- **单一退出码 0/2/1**:让 agent/CI/ship 可直接当闸用,而不是人去读多份输出。🟡(2)单列一档给「软警告需人看」,L3 产物完整性是硬判定故无 🟡。
- **probe 按 git 改动自动选**(`--changed`):实现"每次都跑得起"的关键——只跑被碰到的面,避免全量太重导致实际不跑。优先级 `--only` > `--changed` > `--scope` > 全量。
- **自动探活复用在跑的 dev**:9222 已在则复用(并自动剔 `boot` probe 免 reload 打断 user 会话);没起才后台拉 `bun run dev:desktop`,跑完只杀自己拉起的那个(按命令行路径过滤,不误杀别的 electron)。
- **不注册 npm script 别名**:原本可加 `verify:deskfox` 到 `package.json`,但 `package.json` 是上游同步黑名单文件,注册别名 = 每次跟随上游 merge 多一处摩擦 → 放弃别名,规范里统一用全路径 `bun run packages/branding/smoke/verify.ts`。
- **L3 用 electron-updater 口径,不复用 Tauri 老脚本**:换基座后 `verify-updater-artifacts.ts`(Tauri:`*-setup.exe`+minisign `.sig`)已过时;L3 自己按 electron-updater 口径校验(`*.exe`+`latest.yml` sha512 实算一致 + `.blockmap`)。

## 踩坑

- **cold-start.py conn-refused 误报**:冷启 sidecar 有 ~1.5s 预热窗口,渲染器此间 fetch 拿 `ERR_CONNECTION_REFUSED` 后重试连上;原脚本未白名单 → 误判 FAIL。修法保留「sidecar 真没起来」的检出:conn-refused 单独计数,**仅在终态已连上**(有会话/文件树节点/已渲染 shell)时算预热瞬时;始终没连上则算真 FAIL。

## 验证

- typecheck / oxlint 通过;`verify.ts` 自身在多种 flag 下跑通;`cold-start.py` 冷启动监控判定正确(0/1/2)。
- 详见 3-changelog。
