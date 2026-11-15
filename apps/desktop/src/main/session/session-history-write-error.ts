// 标记普通退出前仍未能写入磁盘的会话记录，不把本机路径交给退出提示。

/** 退出保存失败，用户可以在磁盘恢复后重试。 */
export class SessionHistoryWriteError extends Error {
  /** 封装写入异常，提供固定的对外提示。 */
  constructor(cause?: unknown) {
    super("会话记录写入失败", { cause })
    this.name = "SessionHistoryWriteError"
  }
}
