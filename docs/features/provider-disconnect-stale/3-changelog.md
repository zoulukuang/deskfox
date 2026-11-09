feat-id: provider-disconnect-stale
status: done
related: ./3-changelog.md

# 配置型供应商断开后设置页里消失不掉(Tiny,2026-11-09)

## 现象

设置 → 供应商里对配置型供应商(走 `opencode.json` `provider.<id>` 的,GetBot 即此类)点「断开」,toast 提示已断开,但列表里该供应商仍显示为已连接,重启应用后才消失。

## 根因

配置型供应商断开走 `disabled_providers` 路径:客户端 `updateConfig` → 服务端 `GlobalHttpApi.configUpdate` 写文件后把「销毁全部实例」**fork 出去立即返回**(`bridge.fork(disposeAllInstancesAndEmitGlobalDisposed)`)。客户端 `updateConfigMutation.onSuccess` 立刻 invalidate providers 重拉,请求打到尚未销毁的旧实例,`Provider.list()` 返回的是实例级缓存里仍含该供应商的列表。原 `disableProvider` 既没 dispose 也没 refresh,之后也没有任何事件再触发 providers 重拉。API 密钥型供应商的 `disconnect` 路径一直是 `auth.remove → await global.dispose → refreshProviders`,所以没这个问题。

## 修法

新文件 `packages/app/src/components/provider-disconnect.ts`(fork-only 纯函数):`updateConfig → await global.dispose → await refreshProviders`,dispose / refresh 失败只吞掉(配置已写入,断开事实成立),`updateConfig` 失败才返回失败由组件回滚本地 store。`settings-providers.tsx` 的 `disableProvider` 改为调用它(FORK-BEGIN/END 标注,净改约 15 行)。未动服务端、未动黑名单。

## 测试

`provider-disconnect.test.ts` 6 条:R1 时序(dispose 未完成前不得 refresh,用 deferred 钉死)/ R2 updateConfig 失败不 dispose 不 refresh / R3 dispose 失败仍 refresh / R4 refresh 失败仍 ok / nextDisabledProviders 去重与不可变。app 包 typecheck 与 `bun run test`(unit + browser)全绿,结果见本批 ship 记录。

## 未验项

真桌面点击断开后列表即时消失,待 2026.12.1 候选包人工确认。API 密钥型供应商若同时在 `opencode.json` 里配了 key(source=config、无自定义 models),断开只删 auth 不进 `disabled_providers`,仍会显示为已连接 —— 这是另一条既有逻辑,本批不改。

## 回退

`git revert` 本笔 commit;不涉及数据与配置格式。
