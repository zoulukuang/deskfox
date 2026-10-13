feat-id: share-routing
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 施工顺序

1. S1：修复 enterprise 构建基线；临时本地仓储+安全 API 闭环；再复用公开页面，验证 Node 制品、静态资源与 RPC。
2. S2：固定来源及 durable operation 的正式 DB 迁移；调整 ShareNext 初始化、同步、取消与 Session 删除时序；故障注入集成测试。
3. S3：后端参数与能力声明，两入口捕获目标，生成 Client/SDK；自动分享与旧服务器测试。
4. S4：准备单写服务、精确 Nginx 路由、同地备份恢复及回滚脚本；确认运营参数后实施公开部署。
5. S5：重打 local（合并成本修复的独立测试分支），两站合成数据真验收；Windows 环境具备后双端原生 QA；回填 21 项证据和本期四条需求。

## 2026-10-12 调查结论

- main 基线 b2162c0c7d 与 origin 一致；独立工作树 share-routing，不修改主工作区未提交变更。
- CN 主机 x86_64，无 Node；剩余约 20 GiB。海外 x86_64，现有 Node 18，剩余约 30 GiB。均需独立运行时，不替换既有业务版本。
- 官网为静态站，share 服务不能接管 `/` 或笼统 `/api`；AI HTTPS 经本地 8444 代理。新增路由需同步官方站点配置且保留现有服务。
- 复现两处构建解析失败，补 UI Core 依赖、宿主 dedupe SolidStart 后生产构建和 enterprise typecheck 通过。
- Node 产物已能监听 loopback，但 `/api/doc` 因既有 `z.custom` 无法生成 JSON Schema 返回 500。新请求 schema 必须解决该问题，不能把“构建成功”视为接口通过。
- user 已确认 D-A/B/C；D-D/E/F 按本规格实验验证。D-G 的联系/保留/备份删除政策、Windows 可用入口仍待答复。先推进不依赖这些参数的本地实现。
