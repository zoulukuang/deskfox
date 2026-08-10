# opencode 单测可信基线(REQ-105)

> 用途:REQ-103(上游同步 1.18.x)升级后,用同一套流程重跑并与本目录快照 **diff** —— 新增的确定性失败 = 升级引入,原有的 = 既存债。只记数字不够(数字相同但换一批用例同样是回归),所以存**用例名清单**。

## 快照文件

| 文件 | 平台 | HEAD | 状态 |
|---|---|---|---|
| `baseline-f04b7d5bb2-mac-arm64.txt` | macOS arm64 | `f04b7d5bb2` | ✅ 2026-08-10 |
| `baseline-<sha>-win-x64.txt` | Windows x64 | — | ⏳ 待 Windows 端接力 |

## 基线建立流程(双端同一套,升级后重跑也用这套)

```bash
cd packages/opencode
# 环境预处理(不做则环境型假失败污染结果,不可比):
#   1) 清代理:unset ALL_PROXY HTTP_PROXY HTTPS_PROXY http_proxy https_proxy all_proxy
#      (Clash 类代理会拦 localhost,httpapi/lsp 整组 502+超时 —— 见 memory 环境型假失败速查)
#   2) 英文 locale:export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8(yargs help 快照跟 locale)
#   3) 不要跑 bun install(E6 坑:npmmirror 镜像会重写 bun.lock 3323 行;跑了则 commit 前
#      git checkout -- bun.lock)
bun test 2>&1 | tee /tmp/run1.log          # 第 1 轮全量
bun test 2>&1 | tee /tmp/run2.log          # 第 2 轮全量
# 归一化(剥耗时 + 排序):
norm() { grep -E '^\(fail\)' "$1" | sed -E 's/ \[[0-9.]+m?s\]$//' | sort; }
comm -12 <(norm /tmp/run1.log) <(norm /tmp/run2.log)   # 两轮交集 = 稳定失败候选
# 交集里每条再精确过滤单跑 ×3 定性:
bun test <file> -t "<用例名>"   # 3/3 仍败 = 确定性失败,入基线正文;有过 = flaky,入附录
```

**为什么要两轮 + 过滤复跑**:2026-08-10 Mac 实测,单轮全量会混入大量**冷启动/负载型超时 flaky**(run1 = 16 fail,run2 = 3 fail;交集 3 条里还有 1 条过滤单跑 3/3 全过)。单轮结果当基线,升级后 diff 会满屏噪声。

## Mac 基线定性记录(2026-08-10)

### 确定性失败 2 条(过滤单跑 3/3 败,入基线正文)

| 用例 | 表现 | 性质初判 |
|---|---|---|
| `ShareNext > create posts share, persists it, and returns the result`(`test/share/share-next.test.ts`) | 断言败:fetch mock `seen` 收到 2 次调用,期望 1 次(36ms 即败,非超时) | 测试文件最近改动全是上游 commit(`20bf18ffb4` #31811 等),无 fork 触碰;疑上游测试与重试行为不合,**非 fork 回归**,升级后复查 |
| `instance HttpApi > returns typed not found bodies for missing projects`(`test/server/httpapi-instance.test.ts`) | **确定性超时**(隔离 + 过滤仍 5s 超时,3/3) | 同上,文件历史全上游 commit;疑环境/上游既存,升级后复查 |

### 冷启动/负载 flaky(两轮出没不定 / 过滤单跑即过,不入正文,diff 时不作回归依据)

出没过的文件(union of run1/run2/隔离跑):`httpapi-cors` / `httpapi-sync` / `httpapi-mdns` / `httpapi-pty` / `httpapi-instance-context` / `project-copy` / `agent.test.ts`(哪条用例超时每轮换)/ `control-plane/workspace` / `share-next`(除上表那条)。全部为 **5000ms 超时**型;与 memory「压力 flaky 群」(2026-06 记录,隔离跑全过)同模式。**升级后 diff 若见这批文件超时,先重跑再下结论。**

另:全量 run1 有 1 个 `error`(mdns 超时后的迟到断言,Unhandled error between tests),是上面超时的衍生,不单独计。

### 与 2026-05-28 Windows 旧「19 条」清单的关系

旧清单在 6-13 上游 merge(@1.17.4)之前测量,已过时;其中 `office-tooling/install` hono/effect shape 那条的测试文件已被上游 `28b03595bf` 删除(2026-08-10 核实,Mac 本次跑确认不再出现)。Windows 重跑后在本 README 补「消失 / 仍在 / 新增」三栏对照。

## Windows 端接力清单

1. 拉 main(含本目录),同上流程产出 `baseline-<sha>-win-x64.txt`(历史全量耗时 10-13min/轮)。
2. 与旧 19 条清单(OPENCODE-PLAN `需求池/opencode-win测试基线-shell-permission-fail.md`)对照,写三栏结论(预期:OpenAPI shape 消失;15 条 shell permission 大概率仍在;ModelsDev 取决于本机缓存,如实记录)。
3. 顺手复验 REQ-048 新 hook:`git fetch --tags` 后 git-bash 下 `git cat-file -e upstream-base:<path>` 行为与 Mac 一致。
