// Fork-only feature bundle. Other locales intentionally use English until reviewed.
export const en = {
  // FORK-BEGIN: attachment cost protection [feat: attachment-cost-guard]
  "attachment.cost.title": "Send large attachments?",
  "attachment.cost.description":
    "These inline attachments total {{size}} KiB. They may increase model input costs on this and later turns. File size is not a token estimate.",
  "attachment.cost.textRange":
    "Servers with text attachment protection send at most 50 KiB and 2,000 lines per new text attachment. Older servers may send the full text. Images and PDFs are not covered by that limit.",
  "attachment.cost.reference": "Use text file references",
  "attachment.cost.send": "Continue sending",
  "attachment.cost.unavailable": "An attachment is unavailable. Add it again before sending.",
  "attachment.cost.changed": "The draft or destination changed. Review it and send again.",
  "attachment.cost.jumpTitle": "Model input increased sharply",
  "attachment.cost.jumpDescription":
    "Input grew from {{previous}} to {{current}} tokens, including cache reads and writes. Large attachments or tool results may be contributing. Start a new session or compact this session to reduce repeated input.",
  // FORK-END
}

export const zh = {
  // FORK-BEGIN: attachment cost protection [feat: attachment-cost-guard]
  "attachment.cost.title": "发送大附件？",
  "attachment.cost.description":
    "这些内联附件共 {{size}} KiB，可能增加本轮及后续对话的模型输入费用。文件大小不等于 token 数。",
  "attachment.cost.textRange":
    "支持文本附件保护的服务端，每个新文本附件最多发送 50 KiB、2,000 行。旧服务端可能发送全文；图片和 PDF 不受此限额保护。",
  "attachment.cost.reference": "改用文本文件引用",
  "attachment.cost.send": "继续发送",
  "attachment.cost.unavailable": "有附件无法读取，请重新添加后发送。",
  "attachment.cost.changed": "草稿或发送目标已改变，请检查后重新发送。",
  "attachment.cost.jumpTitle": "模型输入量明显增加",
  "attachment.cost.jumpDescription":
    "输入量从 {{previous}} 增至 {{current}} token，包含缓存读取和写入。大附件或工具结果可能是原因。可新建会话或压缩当前会话，减少重复输入。",
  // FORK-END
}

export function attachmentCostDict(locale: string) {
  return locale === "zh" ? zh : en
}
