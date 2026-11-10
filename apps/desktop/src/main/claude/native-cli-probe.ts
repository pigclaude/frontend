// 通过生产会话适配器启动真实官方 CLI，在独立临时配置内采集合成请求与启动材料。

import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, mkdir, stat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { ClaudeAgentAdapter } from "../session/claude-agent-adapter"
import { SessionEnvironment, placeholderOAuthToken } from "../session/session-environment"
import { matchesRuntimeBinary, runtimeHostArch } from "./runtime-binary"
import { resolveClaudeBinaryPath } from "../session/claude-binary"
import { createNativeProtocolFixture } from "./native-protocol-fixture"
import { NativeDiagnosticCleanupError } from "./native-diagnostic-cleanup"

const run = promisify(execFile)

/** 实际 native CLI 的有限结果，原始请求、metadata 和个人路径不离开探针。 */
export type NativeCliObservation = {
  version: string
  platform: string
  launched: boolean
  configurationPrivate: boolean
  locale: string
  localeAvailable: boolean
  launchEnvironmentMatches: boolean
  legacyPreloadRemoved: boolean
  nativeCredentialIsPlaceholder: boolean
  protocolPreserved: boolean
  metadataPresent: boolean
  bodyBytes: number
}

/** 只向本机假端点发送合成请求，不读取真实账号、执行工具或调用远端模型。 */
export async function probeNativeCli(input: {
  timezone: string
  locale: string
  signal: AbortSignal
  binary?: string
}): Promise<NativeCliObservation> {
  input.signal.throwIfAborted()
  const binary = input.binary ?? resolveClaudeBinaryPath({ arch: runtimeHostArch() })
  if (!(await matchesRuntimeBinary(binary, process.platform, runtimeHostArch())))
    throw new Error("原生 CLI 资源身份不符")
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-native-check-"))
  let fixture: Awaited<ReturnType<typeof createNativeProtocolFixture>> | undefined
  let environment: SessionEnvironment | undefined
  let adapter: ClaudeAgentAdapter | undefined
  let child: ChildProcessWithoutNullStreams | undefined
  let closed: Promise<void> = Promise.resolve()
  let actualEnvironment: Record<string, string | undefined> | undefined
  let actualCommand: string | undefined
  let preparationCleanup: (() => Promise<void>) | undefined
  const controller = new AbortController()
  const abort = (): void => controller.abort(input.signal.reason)
  input.signal.addEventListener("abort", abort, { once: true })
  const cleanup = async (): Promise<void> => {
    controller.abort()
    input.signal.removeEventListener("abort", abort)
    const stopped = adapter?.stop()
    child?.stdin.end()
    if (child && child.exitCode === null && child.signalCode === null) {
      if (!(await finished(closed, 1_500))) child.kill("SIGTERM")
      if (!(await finished(closed, 1_000))) child.kill("SIGKILL")
      if (!(await finished(closed, 3_000))) throw new NativeDiagnosticCleanupError(cleanup)
    }
    if (stopped && !(await finished(stopped, 2_000)))
      throw new NativeDiagnosticCleanupError(cleanup)
    await fixture?.stop()
    await environment?.cleanup()
    await rm(directory, { recursive: true, force: true })
  }
  try {
    await mkdir(join(directory, "home"), { mode: 0o700 })
    await mkdir(join(directory, "workspace"), { mode: 0o700 })
    fixture = await createNativeProtocolFixture()
    environment = await SessionEnvironment.create({
      sessionId: `check-${randomUUID()}`,
      workspace: join(directory, "workspace"),
      daemonBaseUrl: fixture.url,
      sessionToken: fixture.sessionToken,
      timezone: input.timezone,
      locale: input.locale,
      binaryPath: binary,
      userDataPath: directory,
    })
    const session = environment
    const safeEnvironment = {
      ...session.env,
      PATH:
        process.platform === "win32" ? (process.env.PATH ?? "") : "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: join(directory, "home"),
      // 仅在无真实账号的本机诊断进程禁用附加流量，不写入生产会话。
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_TELEMETRY: "1",
    }
    const available =
      process.platform === "win32"
        ? undefined
        : await run("/usr/bin/locale", ["-a"], {
            env: { ...safeEnvironment, LANG: "C", LC_ALL: "C" },
            timeout: 3_000,
            killSignal: "SIGKILL",
            maxBuffer: 262_144,
            signal: input.signal,
          })
    const localeAvailable =
      available === undefined || available.stdout.split(/\r?\n/).includes(session.env.LANG)
    const versionResult = await run(binary, ["--version"], {
      cwd: directory,
      env: safeEnvironment,
      timeout: 5_000,
      killSignal: "SIGKILL",
      maxBuffer: 4_096,
      signal: input.signal,
    })
    const version = /^(\d+\.\d+\.\d+)/.exec(versionResult.stdout.trim())?.[1]
    if (!version) throw new Error("无法确认实际 CLI 版本")
    adapter = new ClaudeAgentAdapter({
      queryFn: (params) =>
        query({
          ...params,
          options: {
            ...params.options,
            allowedTools: [],
            mcpServers: {},
            spawnClaudeCodeProcess: (options) => {
              actualCommand = options.command
              actualEnvironment = { ...options.env }
              const process = spawn(options.command, options.args, {
                cwd: options.cwd,
                env: options.env,
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
              })
              child = process
              process.stderr.resume()
              closed = new Promise<void>((resolve) => process.once("close", resolve))
              return process
            },
          },
        }),
    })
    await adapter.start({
      workspace: session.workspace,
      env: safeEnvironment,
      binaryPath: binary,
      permissionMode: "default",
      abortController: controller,
      canUseTool: async () => ({ behavior: "deny", message: "本机诊断不执行工具" }),
    })
    input.signal.throwIfAborted()
    await adapter.send("PigClaude native environment diagnostic. Do not use tools.")
    const forwarded = await withSignal(fixture.forwarded, input.signal, 15_000)
    const original = fixture.incoming()
    const originalAuthorization = original?.headers.authorization
    const ua = original?.headers["user-agent"]
    let metadataPresent = false
    try {
      const parsed: unknown = JSON.parse(original?.body.toString("utf8") ?? "null")
      metadataPresent = parsed !== null && typeof parsed === "object" && "metadata" in parsed
    } catch {
      /* 合成请求没有可解析 metadata 时只记录事实。 */
    }
    const protocolPreserved =
      original !== undefined &&
      original.headers["x-pigclaude-session"] === fixture.sessionToken &&
      original.body.equals(forwarded.body) &&
      forwarded.headers["user-agent"] === ua &&
      typeof ua === "string" &&
      ua.includes(`claude-cli/${version}`) &&
      forwarded.headers["x-pigclaude-session"] === undefined &&
      forwarded.headers.authorization === "Bearer pigclaude-diagnostic-upstream" &&
      forwarded.headers["anthropic-beta"]?.includes("oauth-2025-04-20") === true
    const privateMode =
      process.platform === "win32" || ((await stat(session.configDir)).mode & 0o777) === 0o700
    return {
      version,
      platform: `${process.platform}/${runtimeHostArch()}`,
      launched: child?.pid !== undefined && actualCommand === binary,
      configurationPrivate:
        privateMode && actualEnvironment?.CLAUDE_CONFIG_DIR === session.configDir,
      locale: session.env.LANG,
      localeAvailable,
      launchEnvironmentMatches:
        actualEnvironment?.TZ === session.env.TZ &&
        actualEnvironment?.LANG === session.env.LANG &&
        actualEnvironment?.LC_ALL === session.env.LC_ALL,
      legacyPreloadRemoved: actualEnvironment?.NODE_OPTIONS === undefined,
      nativeCredentialIsPlaceholder: originalAuthorization === `Bearer ${placeholderOAuthToken}`,
      protocolPreserved,
      metadataPresent,
      bodyBytes: original?.body.length ?? 0,
    }
  } catch (error: unknown) {
    if (error instanceof NativeDiagnosticCleanupError) preparationCleanup = error.cleanup
    throw error
  } finally {
    const retry = async (): Promise<void> => {
      const results = await Promise.allSettled([cleanup(), preparationCleanup?.()])
      if (results.some((result) => result.status === "rejected"))
        throw new Error("原生诊断准备与运行资源尚未全部回收")
    }
    try {
      await retry()
    } catch {
      throw new NativeDiagnosticCleanupError(retry)
    }
  }
}

async function finished(operation: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function withSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: () => void = () => undefined
  try {
    signal.throwIfAborted()
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener("abort", abort, { once: true })
        timer = setTimeout(() => reject(new Error("原生诊断超时")), milliseconds)
      }),
    ])
  } finally {
    signal.removeEventListener("abort", abort)
    if (timer) clearTimeout(timer)
  }
}
