// 验证实际 Linux 安装内 CLI 经 SDK 启动后，Bun Intl 读取本次会话的语言和时区。

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { expect, it } from "vitest"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { SessionEnvironment } from "./session-environment"
import { probeNativeCli } from "../claude/native-cli-probe"

const resourcesPath = process.env["PIGCLAUDE_TEST_INSTALLED_LINUX_RESOURCES"]
const supported = process.platform === "linux" && Boolean(resourcesPath)

it.skipIf(!supported)(
  "随包 Claude Code 在两组已安装的 Linux locale 下实际使用各自的 Intl 默认值",
  async () => {
    if (!resourcesPath) throw new Error("缺少 AppImage 挂载时的资源目录")
    const original = Object.getOwnPropertyDescriptor(process, "resourcesPath")
    Object.defineProperty(process, "resourcesPath", { configurable: true, value: resourcesPath })
    try {
      const binary = resolveClaudeBinaryPath({ env: {} })
      for (const [locale, timezone] of [
        ["en-US", "America/Chicago"],
        ["fr-FR", "Europe/Paris"],
      ] as const) {
        const result = await probeNativeCli({
          locale,
          timezone,
          binary,
          signal: AbortSignal.timeout(30_000),
        })
        expect(result).toMatchObject({
          launched: true,
          localeAvailable: true,
          launchEnvironmentMatches: true,
          nativeCredentialIsPlaceholder: true,
          protocolPreserved: true,
        })
        const actual = await inspectIntl(binary, locale, timezone, result.locale)
        expect(actual).toEqual({
          locales: Array<string>(6).fill(locale),
          timezone,
          localeEnv: [result.locale, result.locale],
          preloadAbsent: true,
          explicitLocale: "de-DE",
        })
        console.log(JSON.stringify({ locale, timezone, native: result, intl: actual }))
      }
    } finally {
      if (original) Object.defineProperty(process, "resourcesPath", original)
      else Reflect.deleteProperty(process, "resourcesPath")
    }
  },
  100_000,
)

async function inspectorUrl(): Promise<string> {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  if (address === null || typeof address === "string") throw new Error("无法分配回环检查器端口")
  return `ws://127.0.0.1:${address.port}/pigclaude-test-intl`
}

async function inspectIntl(
  binary: string,
  locale: string,
  timezone: string,
  posixLocale: string,
): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-installed-cli-intl-"))
  const url = await inspectorUrl()
  const controller = new AbortController()
  const environment = await SessionEnvironment.create({
    sessionId: "intl",
    workspace: directory,
    userDataPath: directory,
    daemonBaseUrl: "http://127.0.0.1:9",
    sessionToken: "synthetic-intl",
    timezone,
    locale,
    binaryPath: binary,
  })
  let child: ChildProcessWithoutNullStreams | undefined
  let childClosed: Promise<unknown> | undefined
  let socket: WebSocket | undefined
  const adapter = new ClaudeAgentAdapter({
    queryFn: ({ prompt, options }) =>
      query({
        prompt,
        options: {
          ...options,
          allowedTools: [],
          mcpServers: {},
          spawnClaudeCodeProcess: (input) => {
            expect(input.command).toBe(binary)
            expect(input.env.LANG).toBe(posixLocale)
            child = spawn(input.command, input.args, {
              cwd: input.cwd,
              env: { ...input.env, BUN_INSPECT: url },
              signal: input.signal,
              stdio: ["pipe", "pipe", "pipe"],
            })
            child.stderr.resume()
            childClosed = once(child, "close").catch(() => undefined)
            return child
          },
        },
      }),
  })
  try {
    await adapter.start({
      workspace: directory,
      env: {
        ...environment.env,
        HOME: directory,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_TELEMETRY: "1",
      },
      binaryPath: binary,
      permissionMode: "default",
      canUseTool: async () => ({ behavior: "deny", message: "安装验收不执行工具" }),
      abortController: controller,
    })
    socket = await connectInspector(url)
    return await readIntl(socket)
  } finally {
    socket?.close()
    controller.abort()
    await adapter.stop()
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await childClosed
    await environment.cleanup()
    await rm(directory, { recursive: true, force: true })
  }
}

async function connectInspector(url: string): Promise<WebSocket> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const socket = new WebSocket(url)
    const connected = await once(socket, "open", { signal: AbortSignal.timeout(1_000) }).then(
      () => true,
      () => false,
    )
    if (connected) return socket
    socket.close()
    await delay(250)
  }
  throw new Error("安装内原生 CLI 的回环检查器未就绪")
}

async function readIntl(socket: WebSocket): Promise<unknown> {
  const response = new Promise<unknown>((resolve, reject) => {
    const signal = AbortSignal.timeout(7_000)
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    socket.addEventListener(
      "message",
      (event) => {
        const value: unknown = JSON.parse(String(event.data))
        if (typeof value !== "object" || value === null || Reflect.get(value, "id") !== 1) return
        const protocolResult: unknown = Reflect.get(value, "result")
        if (typeof protocolResult !== "object" || protocolResult === null) return
        const result: unknown = Reflect.get(protocolResult, "result")
        if (typeof result === "object" && result !== null) resolve(Reflect.get(result, "value"))
      },
      { signal },
    )
    socket.addEventListener("error", reject, { once: true, signal })
  })
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        returnByValue: true,
        expression: `({
          locales: [
            Intl.DateTimeFormat, Intl.NumberFormat, Intl.Collator,
            Intl.PluralRules, Intl.RelativeTimeFormat, Intl.ListFormat,
          ].map((Constructor) => new Constructor().resolvedOptions().locale),
          timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
          localeEnv: [process.env.LANG, process.env.LC_ALL],
          preloadAbsent: process.env.LD_PRELOAD === undefined,
          explicitLocale: new Intl.NumberFormat("de-DE").resolvedOptions().locale,
        })`,
      },
    }),
  )
  return response
}
