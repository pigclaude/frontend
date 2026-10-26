// 只保留给测试使用的脱敏会话样例；生产页面已消费真实会话事件，不再注入这个 fixture。

/** 会话页面使用的脱敏 fixture 类型。 */
export type SessionFixture = {
  project: string
  account: string
  proxy: string
  suggestions: Array<{ title: string; description: string; icon: string }>
  userMessage: string
  assistantParagraphs: string[]
  steps: Array<{ kind: string; value: string }>
  relayEvent: { time: string; text: string }
  diff: { files: string[]; additions: number; deletions: number; lines: string[] }
  permission: { command: string; description: string }
  environment: Array<{ label: string; value: string }>
  accounts: Array<{ name: string; time: string }>
  usage: { requests: number; tokens: string }
}

/** 会话新建态与进行中态共用的脱敏 fixture。 */
export const sessionFixture: SessionFixture = {
  project: "frontend",
  account: "主力 Max",
  proxy: "LA-01",
  suggestions: [
    { title: "继续上次", description: "流开始后不再换号 · frontend", icon: "clock" },
    { title: "审查改动", description: "看看改了什么、有没有风险", icon: "eye" },
    { title: "跑测试", description: "失败的用例顺手修掉", icon: "terminal" },
    { title: "解释仓库", description: "目录结构和依赖方向", icon: "book" },
  ],
  userMessage:
    "daemon 里响应体已经开始写出之后，遇到 429 还会再请求一次上游。改成一旦开始写就不再换号，并补一条测试。",
  assistantParagraphs: [
    "先看现在的重试逻辑在哪里判断「是否已写出响应体」。",
    "问题在 forwardWithRetry：判断 429 时没有看 state.bodyStarted。把它放进条件里，响应体开始之后的 429 就会原样交回 Claude Code。",
    "测试补在 daemon-quota-proxy.test.ts，现在跑一下这个文件。",
  ],
  steps: [
    { kind: "读取", value: "src/daemon.ts" },
    { kind: "搜索", value: "x-quota-exhausted · 3 处" },
  ],
  relayEvent: { time: "14:32", text: "工作 Max 额度用尽，中继在同一请求内换到主力 Max" },
  diff: {
    files: ["src/daemon.ts", "src/daemon-quota-proxy.test.ts"],
    additions: 36,
    deletions: 4,
    lines: [
      "src/daemon.ts  @@ -151,4 +151,7 @@",
      "−    if (res.status === 429 && isQuotaExhausted(res)) {",
      "+    const retryable = res.status === 429 && isQuotaExhausted(res)",
      "+    if (retryable && !state.bodyStarted && body.byteLength <= MAX_REPLAY) {",
      "     rejected.push(account.id)",
      "+    const next = choose({ rejectedIds: rejected })",
    ],
  },
  permission: {
    command: "pnpm --dir packages/daemon exec vitest run src/daemon-quota-proxy.test.ts",
    description: "允许运行这条命令吗？",
  },
  environment: [
    { label: "请求地址", value: "127.0.0.1:47821" },
    { label: "时区", value: "America/Los_Angeles" },
    { label: "~/.claude/settings.json", value: "已忽略" },
  ],
  accounts: [
    { name: "工作 Max", time: "14:05" },
    { name: "主力 Max", time: "14:32 起" },
  ],
  usage: { requests: 14, tokens: "192.0K" },
}
