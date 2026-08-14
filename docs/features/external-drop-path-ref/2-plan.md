feat-id: external-drop-path-ref
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划与决策轨迹

## 决策 1:图片继续内联,只改非图片

一开始想「统一走路径引用,一了百了」。放弃了,两个理由:

- **视觉模型要的是字节**。图片走引用等于让 agent 用 read 工具去读图 —— 多绕一层且未必等价。
- **粘贴截图没有路径**。剪贴板来的 File 没有 `path`,一律要求路径会把今天能用的场景弄坏。

所以规则是「图片 → 内联;其余有路径 → 引用;没路径 → 回落内联」。
第三条不是兜底摆设:浏览器拖来的虚拟文件同样没有真实路径。

## 决策 2:路由逻辑放新文件,`attachments.ts` 只接线

R1 三级跳第 2 档。`attachments.ts` 是上游文件且本次同步刚改了 180 行,
深改会让下次 merge 还债。最终 `attachments.ts` 只动了三处:import、一行判定、drop 分流块。

## 决策 3:判定必须抽成纯函数 —— 被测试环境逼出来的

原本想直接在 `attachments.test.ts` 里构造 `createPromptAttachmentsCore` 测拦截行为。
**实撞失败**:import `attachments.ts` 会连带拉起 solid-js,bun test 下抛
`Export named 'use' not found in module solid-js/web/dist/server.js`。

仓内 `file-tree.test.ts` 早有同样结论并写在注释里(「直接从纯逻辑 helper import,
不再 import 整个组件」)。于是把 `shouldBlockAsImage` / `rejectionToastKind`
下沉到 `external-drop.ts`,组件只调用。**这不是为了好看,是这个仓的测试环境只能这么测。**

## 决策 4:全走引用时不再弹「不支持的附件」

分流后如果一批文件全走了路径引用,`addAttachments` 收到空数组 —— 直接调用会误弹
「不支持的粘贴」。改为只在确有内联文件时才调,且把 toast 开关与「是否已有引用」挂钩。

## 踩到的坑

1. **同一个 bug 有两处**。`add()` 里的图片拦截和 `addAttachments()` 里的聚合提示,
   都不看文件类型就当图片处理。只修前者的话,「一批 .txt 全被拒」仍会弹图片提示。
   ——「发现有害 pattern → 全仓 grep 同类逐个评估」,这次是同文件内两处。
2. **分支基线**。`attachments.ts` 在 main 与同步分支之间差 180 行(上游 v1.18.16 blob 化附件),
   所以本 feat **必须基于 `sync/upstream-2026-08-10`**,不能从 main 起。已在 spec §七 写明。

## 验收执行

- 单测 16 条(L1–L8 路由 + R1–R3c 拦截范围)全过
- typecheck 通过
- app 包全量:890 pass / 12 fail —— 改动前是 874/12,**失败项完全相同**(既有基线红)
- 真机回归(重建包后):第 2 组 7/7、第 3 组 16 通过 2 跳过、第 4 组 11/11
- **M1–M4 需人工**:系统级拖放 CDP 喂不进去(见 `smoke/MANUAL-CHECKLIST.md` #9a)
