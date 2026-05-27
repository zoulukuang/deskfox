feat-id: feishu-merge-forward-image-400
status: done
related: ./3-changelog.md

# 3-changelog · 合并转发图片 graceful 降级(飞书平台限制)

> Tiny+(净 -13 行 / 3 文件)→ 按规范只写本 changelog。

## 问题

真机测试发现:给飞书 bot 发**合并转发**(含图)→ 文字识别 OK,但子图下载全部 **HTTP 400 Bad Request**(`merge_forward 子图 ... 下载失败 400`),bot 拿不到图、表现混乱(占位说"已展开识别"其实没图 / 被问起才含糊解释)。

## 根因(飞书平台硬限制,不可修)

飞书官方接口文档明确:**"暂不支持获取合并转发消息中的子消息、卡片消息中的资源文件;传入合并转发消息或子消息 ID 返回错误码 234043。"**([获取消息中的资源文件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-resource/get))

→ 换任何 message_id / 端点 / 参数都下不下来。原 merge_forward 图片机制建立在错误前提上,单测 mock fetch 掩盖了真实 400,**真实世界从没成功过**。

## 改动(commit `aadbd245c`)— graceful 降级

下载本就不可能,故不"修下载",改为诚实降级:
- `merge-forward-flatten.ts`:`FlattenResult` 加 `imageCount`(总图数,供提示计数)。
- `message-pipeline.ts handleMergeForward`:
  - flatten `maxImages=0`(含嵌套)→ 不建下载列表、不渲染假的"[图片(已展开识别)]"(改"[图 N(未展开)]")。
  - **停掉死下载循环**(省 5×400 网络往返 + 错误日志噪音),`imageParts` 恒空。
  - prompt 告知 LLM"合并转发内图读不了、只基于文字答,无需在回复重复说明"。
  - **回复头部**加一行诚实提示:`📷 合并转发里的 N 张图片我读不了(飞书接口限制),需要识别请直接把图转发给我。`(仅含图时)
  - 移除原"当前 model 不支持图片识别"警告(对合并转发是误导 — 问题在飞书不在 model)。

## 测试 / 回归

- `merge-forward-flatten` M6 加 `imageCount=2` 断言(maxImages=0 时 images=[] 但计数正确)。
- 飞书 622 pass / 0 fail + typecheck 17/17。
- **真机 UX user 确认通过**(2026-05-27):合并转发含图 → 头部提示出现 + 文字总结正常 + 无失败下载噪音。

## 备注

真·下载合并转发内图片是**飞书平台限制(won't-fix)**;本 feat 只做 graceful 处理。用户侧办法:要识别就直接转发图片(非合并转发)。backlog `OPENCODE-PLAN/需求池/飞书合并转发子图下载-400-bug.md` 已标 graceful 解决。
