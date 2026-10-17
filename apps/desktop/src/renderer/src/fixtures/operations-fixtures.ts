// 负责提供用量、环境、设置和托盘页面使用的脱敏数据。
import { environmentFixtures, usageFixtures } from "./renderer-fixtures"

/** 用量页面展示 fixture。 */
export const operationsUsageFixture = {
  ...usageFixtures,
  stats: [
    ["请求", "312", "昨天同时段 288"],
    ["输入 Token", "1.24M", "缓存命中 68%"],
    ["输出 Token", "41.6K", ""],
    ["平均耗时", "3.9s", "首字 1.4 秒"],
    ["错误率", "0.3%", "1 次 529"],
  ],
} as const

/** 环境页面展示 fixture。 */
export const operationsEnvironmentFixture = environmentFixtures

/** 设置页面展示 fixture。 */
export const settingsFixture = {
  accountName: "林舟",
  accountEmail: "lin•••@example.com",
  relayPort: "47821",
  dataDir: "~/Library/Application Support/pigclaude",
  version: "0.1.0",
  claudeVersion: "2.1.296",
} as const

/** 托盘页面展示 fixture。 */
export const trayFixture = {
  percent: "62%",
  account: "主力",
  attention: "旧号 Pro 需要重新授权",
  accounts: [
    { name: "主力 Max", mark: "主", usage: "62%" },
    { name: "备用 Pro", mark: "备", usage: "8%" },
  ],
} as const
