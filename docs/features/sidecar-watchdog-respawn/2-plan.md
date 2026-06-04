feat-id: sidecar-watchdog-respawn
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 实施计划与决策轨迹

## 决策轨迹

### D1 — 轮询式看门狗 vs Terminated-事件式
- Terminated 事件已被启动期 health check 的 `tokio::select!` 消费(server.rs),ready 胜出后 terminated future 被 drop → 启动后死亡无人感知。要复用需改 serve() 签名 + 启动竞速路径(脆弱)。
- **决策**:改用独立轮询任务(每 5s ping `/global/health`)。优点:① 零侵入启动路径 ② 额外覆盖"进程在但 hang"的假死。代价:检测延迟 ~15s(可接受,远好于"永久死")。Terminated 即时检测留作后续增强。

### D2 — 同 port vs 新 port 重启
- **决策:同 port + 同 password**。前台 SDK base URL / basic auth 凭据不变 → 新实例 healthy 后请求自动恢复,**无需前台 URL 重定向管线**。代价:旧进程端口 TIME_WAIT 风险 → 杀旧 child 后 sleep 500ms 让端口释放 + health 轮询本就带重试。

### D3 — 熔断防 restart storm
- 确定性崩溃(如配置错)会让看门狗死循环重启耗资源。**决策**:120s 窗口内重启 >5 次则放弃 + 发 `gave-up` 事件。抽 `over_restart_budget` 纯函数便于单测。

### D4 — 误重启防护
- quit / 主动 kill 不能触发重启。**决策**:`ServerState` 加 `shutting_down: Arc<AtomicBool>`,`kill_sidecar` 在取 child 前置位,看门狗每轮 poll 检查。

### D5 — 前台提示用硬编码中文 vs i18n key
- **决策**:FORK 块内硬编码中文(DeskFox 主用户中文)。理由:① 状态提示非品牌串(不违 R3)② 避免新增 i18n key 漏改某 locale 的风险 ③ 功能恢复不依赖提示。i18n 化列为可选后续。

### D6 — Layer① 截什么、不截什么
- **截**:reasoning(thinking,Workflow 时体量最大)、tool 结果(子任务输出大头)、tool 入参大字段。**不截**:最终答案 text。
- tool-input-delta 是部分 JSON,**不在流式中途截**(破坏 JSON);改为在最终 parsed 阶段截大字符串字段(合法 JSON,且 providerExecuted 不影响执行)。

## 风险与缓解(承自 REQ-049 §六)
- R1 看门狗嵌主进程:主进程崩则看门狗也亡 → 本 feat 不解决(REQ-049 缺口3,独立 supervisor 与"不动架构"冲突,留档)。
- R2 重启窗口消息丢失:同 port 2-5s 窗口内飞书新消息补拉未验证 → REQ-049 阶段3 再核实。
- R3 检测延迟 15s:可接受;即时检测后续补。
