feat-id: macos-ship-命令
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 实施计划 + 决策轨迹

## 落点决策

- **skill 文件**:`.claude/commands/ship.md`(本机生效)。`.claude/` 被 gitignore(会话状态本地),所以 skill **不入仓**。
- **为什么不入仓**:Win 端有自己的 `/ship`(各端本地)。若把 macOS 版入仓项目级 `.claude/commands/ship.md`,Win 端 pull 后会被覆盖成 macOS 版,冲突。各端本地各自的 `/ship` 最干净。
- **知识沉淀**:发布 SOP 的设计 + 步骤 + 决策入仓本 feat 三文档(可据此重建 skill);skill 全文在本机。

## 步骤映射(Win 0-8 → macOS)

| # | macOS 做法 | 关键差异 |
|---|---|---|
| 0 | 分支(prod 须 main)/工作树/config.env 检查 | 不满足直接停 |
| 1 | `/code-review` 高危停问,小问题记 | 同 Win |
| 2 | `pkill -9 DeskFox/opencode-cli` | macOS 命令 |
| 3 | `source config.env` + `pack-installer.sh -Env prod`(bump→build[签名+公证]→重命名) | **签名公证内置** |
| 3.5 | `stapler validate` + `spctl -a` 门禁 | **macOS 新增,不公证不推送** |
| 4 | `chore/ship-mac-prod-<版本>` commit bump | mac 前缀 |
| 5 | tag `ship-mac-prod-<版本>` | mac 前缀避免撞 Win |
| 6 | push chore+tag → `gh release create --repo zoulukuang/deskfox --latest <.dmg>` | .dmg |
| 7 | 7a Gitee API curl 建 release + 7b `mirror-asset-to-gitee.sh <tag>` | 复用现成脚本 |
| 8 | 报告(版本/链接/路径 + bump 未合 main 提醒) | 同 |

## 复用的现成脚本(零重造)

`pack-installer.sh` / `bump-installer-version.sh` / `build-deskfox.sh`(签名公证集成,feat `macos-codesign-notarize`)/ `mirror-asset-to-gitee.sh` / `~/.deskfox-signing/3-notarize.sh` / `gh` / Gitee API。`/ship` 只是编排层 + 公证门禁逻辑。

## Resume 设计(应对苹果公证不稳)

苹果公证可能卡数小时,所以发布拆两段:
- `/ship`:跑到 3.5,公证过→续推送;未过→停,产物留本地。
- `/ship resume`:`3-notarize.sh` 补公证 → 重判门禁 → 续 4-8(版本号从 .dmg 文件名解析,不重 build)。

## 范围

- 本期聚焦 **prod 稳定版**(用户核心诉求,签名公证完整)。
- dev/beta 签名公证为 backlog(`build-deskfox.sh` §1.8 当前只 prod 启用签名);`/ship dev|beta` 暂停下确认。
