# DeskFox 分享服务部署与恢复

状态：2026-10-12 两站已部署并通过公网与真实 local 验收；详见同目录 DEPLOYED-20261012.md。两地使用同一 `.output` 制品；Node 22+ 使用独立 `/opt/deskfox-share/node`，不升级网站已有运行时。

## 上线前置

- 用户已确认区域规则；2026-10-19 确认公开分享保留到用户取消、同区域备份保留七天，沿用官网邮箱接收删除／举报。当前限额是初始值，容量验证范围见本轮发版准备记录。
- 两站既有配置在 `/Volumes/ExtSSD/deskfox-web`。CN 为网站 TLS server；AI 为 443 前置代理后的本机 8444 TLS server。先核实前置代理的可信客户端 IP 传递链，再配置 `real_ip`；禁止信任任意来源的 X-Forwarded-For。否则所有流量可能合并为一个本机 IP 桶。
- 4410 是候选 loopback 端口，安装前须检查两台主机都未被占用。官网现有 `/`、下载和更新路由保持不动，不能代理整个 `/api`。
- 用户于 2026-10-12 明确授权同时部署两站；2026-10-19 两站定时备份均已部署，实际备份、服务恢复和 timer 状态通过。正式客户端尚未发布，Windows 安装升级尚未验收。

## 制品与服务

在 enterprise 包执行 `bun run build`；将 `.output/` 连同校验清单存为只读 release。维护 CLI 单独编译：

```sh
bun build src/deskfox/maintenance-cli.ts --target=node --outfile=.output/maintenance.mjs
```

服务采用专用 `deskfox-share` 用户和组、无登录 shell。代码放 `/opt/deskfox-share/releases/<release>/`，`current` 指向该目录，目录内包含 `server/index.mjs` 和 `public/`。服务数据放 `/var/lib/deskfox-share/data`（0700），与官网 rsync --delete 目录完全分离。备份也放同区域的私有目录，不能进入官网根目录。

安装 env（0640）、service 和 Nginx snippets 后：在 http 块 include `share-http.conf`（限流共享区），目标 TLS server include `share-locations.conf`。动态路由包含边缘请求/连接限流，静态构建资源不共用该突发限额。验证配置 `systemd-analyze verify`、`nginx -t`；启动服务并检查 loopback health，再 reload Nginx。上述安装、配置检查、启动及健康检查已在两主机执行。

`flock` 在整个 Node 生命周期持有唯一写锁；不能在同一目录启动第二个 Node，也不能绕过锁启动维护工具。systemd 限制可写路径，Node 仅监听 127.0.0.1。动态响应 no-store，精确代理覆盖 `/api/share`、`/share/`、`/_server`、`/_build/`、`/share-assets/`。

## 运维操作

备份/删除/恢复前停止分享 service，在相同 `writer.lock` 下以服务用户运行 CLI。加载本地区域 env，并设置 `DESKFOX_SHARE_MAINTENANCE_LOCK=held`；该值是包装器约定，不是锁本身。命令形态：

```sh
flock --exclusive --nonblock /var/lib/deskfox-share/writer.lock \
  /opt/deskfox-share/node/bin/node /opt/deskfox-share/current/maintenance.mjs backup /var/lib/deskfox-share/backups/NEW_BACKUP
```

- `remove SHARE_ID`：离线管理删除，只打印状态，不打印 secret/正文。删除写入墓碑；重复删除安全。保留墓碑，不允许清空它来释放空间。
- `backup NEW_ABSOLUTE_DIRECTORY`：只能创建新备份目录，校验 envelope，逐文件哈希，最后写 manifest。备份含删除凭据，必须同地、私有、受访问控制；用户 2026-10-19 确认备份最多保留七天，公开分享仍保留到用户取消。
- `prune-backups ABSOLUTE_BACKUPS`：只清理定时包装器格式的完整、同区域、已满七天备份。清单异常或区域不符时整批拒绝；不处理实时数据、删除账本及非定时目录。
- `restore BACKUP NEW_ABSOLUTE_DIRECTORY`：校验区域和全部哈希；要求当前完整数据/删除账本仍在，将备份之后的墓碑覆盖进去，恢复到新目录。缺少任一旧记录的最新账本就拒绝恢复。核查完成后才切换 env 中的数据目录并重启服务。
- **整盘丢失且最新删除账本不可验证时，禁止将旧备份正文重新公开**。本版恢复命令会拒绝缺失账本；异机灾备及删除账本的持久复制需随最终运营方案验收，不承诺任意旧备份可直接上线。

恢复测试覆盖「备份后取消→旧备份恢复→仍不可读/不可同步」和区域串用、哈希篡改拒绝。恢复不重新分配 ID，不跨区域合并数据。

## 验收及回退

定时备份使用本目录 `deskfox-share-backup.sh`、同名 `.service` 与 `.timer`。维护 CLI 放独立不可变目录 `/opt/deskfox-share/maintenance/<version>/maintenance.mjs`，`maintenance-current` 指向已验版本，不修改网页 release。脚本安装到 `/usr/local/libexec/deskfox-share-backup`。timer 每日 02:10 UTC 加最多十分钟随机延迟（北京时间 10:10–10:20），停服持 writer.lock 完成备份后恢复服务，再清理七天旧档；失败也恢复原运行状态，失败备份不触发旧档清理。离线时不能承诺精确到秒的保留边界，恢复运行后补执行。

安装前验证 `bash -n`、`systemd-analyze verify`，先手动运行 service 并检查分享 health、备份目录 0700／文件 0600、取消后恢复不复活，再 `systemctl enable --now deskfox-share-backup.timer`。回退先停用 timer，恢复 `maintenance-current`，不删除实时数据或删除账本；已有备份仍须按七天政策处理。

2026-10-19 两站已安装相同 CLI `maintenance/20261019-2bb98c73/maintenance.mjs`（SHA-256 `2bb98c7317b258cb920ec7dcb9bd5584f70d6818986ba3d89f09dab54b6e5b44`）。海外两次实际备份均为 6 records，大陆一次为 10 records；service Result=success，timer enabled/active。同目录 `share-notice.ai.html`／`share-notice.cn.html` 已分别同步两站，非公开回退副本在各自主机 /var/backups。大陆首次安装发现 /usr/local/libexec 不存在，补建后完成，失败阶段未停止分享服务。

两站分别创建合成会话，初始同步后访问页面/静态资源/RPC；核对公开域名与独立落盘，另一站无数据；取消后 page/data/RPC 404、no-store。核查官网首页、下载/更新、既有服务无回归。记录进程 UID、监听地址、目录权限、版本/制品 SHA、内存/磁盘和真实 IP 限流结果。

客户端回退必须保留来源固定及取消修复。服务回退只切换到兼容 version 1 envelope 的只读 release；数据/墓碑不回退。若服务不兼容，保持公开路由关闭并保留数据及删除账本，不能把旧备份覆盖回当前目录。
