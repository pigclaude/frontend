// 负责提供 renderer 页面使用的脱敏演示数据。

/** 账号页面展示的脱敏账号记录。 */
export const accountFixtures = [
  {
    id: "work",
    name: "工作 Max",
    mark: "工",
    status: "已用尽 · 1:20 后恢复",
    usage: 100,
    autoSwitch: true,
  },
  {
    id: "primary",
    name: "主力 Max",
    mark: "主",
    status: "服务中 · 2:14 后重置",
    usage: 62,
    autoSwitch: true,
  },
  {
    id: "backup",
    name: "备用 Pro",
    mark: "备",
    status: "待命 · 4:51 后重置",
    usage: 8,
    autoSwitch: true,
  },
  {
    id: "legacy",
    name: "旧号 Pro",
    mark: "旧",
    status: "需要重新授权",
    usage: null,
    autoSwitch: false,
  },
] as const

/** 代理页面展示的脱敏代理记录。 */
export const proxyFixtures = [
  {
    id: "la-01",
    name: "LA-01",
    exit: "203.0.113.42",
    region: "洛杉矶 · 住宅",
    latency: 186,
    accountId: "primary",
    available: true,
  },
  {
    id: "sjc-02",
    name: "SJC-02",
    exit: "198.51.100.17",
    region: "圣何塞",
    latency: 172,
    accountId: "work",
    available: true,
  },
  {
    id: "sea-03",
    name: "SEA-03",
    exit: "203.0.113.88",
    region: "西雅图 · 出口不固定",
    latency: 201,
    accountId: "backup",
    available: false,
  },
] as const

/** 用量页面展示的脱敏元数据。 */
export const usageFixtures = {
  daily: [312, 420, 288, 530, 680, 740, 510],
  models: [
    { name: "Sonnet 5.5", tokens: "32.3M", ratio: 72 },
    { name: "Opus 5.5", tokens: "9.4M", ratio: 21 },
    { name: "Haiku 5.5", tokens: "3.1M", ratio: 7 },
  ],
  requests: [
    {
      id: "usage-1",
      time: "14:32",
      account: "主力 Max",
      model: "Opus 5.5",
      status: 200,
      input: 1200,
      output: 860,
      kind: "all",
    },
    {
      id: "usage-2",
      time: "14:31",
      account: "工作 Max",
      model: "Opus 5.5",
      status: 429,
      input: 1200,
      output: 0,
      kind: "switch",
    },
    {
      id: "usage-3",
      time: "14:28",
      account: "备用 Pro",
      model: "Sonnet 5.5",
      status: 503,
      input: 640,
      output: 0,
      kind: "error",
    },
  ],
} as const

/** 环境检测页面展示的脱敏检查记录。 */
export const environmentFixtures = {
  accountId: "primary",
  checks: [
    { label: "请求地址", value: "127.0.0.1:47821", status: "ok" },
    { label: "时区", value: "America/Los_Angeles", status: "ok" },
    { label: "~/.claude/settings.json", value: "应用内会话不读取", status: "ok" },
  ],
  route: [
    { label: "会话进程", value: "Claude Code · Agent SDK", status: "ok" },
    { label: "本机中继", value: "127.0.0.1:47821", status: "ok" },
    { label: "账号绑定代理", value: "LA-01 · 203.0.113.42", status: "ok" },
    { label: "api.anthropic.com", value: "代理出口", status: "ok" },
  ],
} as const

/** 会话环境和服务账号展示的脱敏记录。 */
export const sessionFixtures = {
  environment: environmentFixtures.checks,
  accounts: [
    { name: "工作 Max", time: "14:05" },
    { name: "主力 Max", time: "14:32 起" },
  ],
  usage: { requests: 14, tokens: "192.0K" },
} as const
