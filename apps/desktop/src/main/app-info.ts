// 负责通过 IPC 返回应用版本、本机数据目录和随包 Claude Code 版本。

import { app, ipcMain } from "electron"
import { readClaudeCodeVersion } from "./session/claude-version"

/** 注册应用信息查询。Claude Code 版本读取成功后复用，失败时下次查询会重试。 */
export function registerAppInfoIpc(): void {
  let claudeCodeVersion = readClaudeCodeVersion()
  ipcMain.handle("pigclaude:app-info", async () => {
    const version = await claudeCodeVersion
    if (version === null) claudeCodeVersion = readClaudeCodeVersion()
    return {
      appVersion: app.getVersion(),
      userDataPath: app.getPath("userData"),
      claudeCodeVersion: version,
    }
  })
}
