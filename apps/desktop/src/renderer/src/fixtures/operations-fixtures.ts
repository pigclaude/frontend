// 负责提供设置页仍然使用的静态展示数据；聊天、环境、用量和托盘已改为真实数据。

/** 设置页面展示 fixture。 */
export const settingsFixture = {
  accountName: "林舟",
  accountEmail: "lin•••@example.com",
  relayPort: "47821",
  dataDir: "~/Library/Application Support/pigclaude",
  version: "0.1.0",
  claudeVersion: "2.1.296",
} as const
