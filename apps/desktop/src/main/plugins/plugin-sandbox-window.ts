// 装配隐藏的沙箱窗口和专用内存分区，验证预加载与 Worker 后才接受调用。
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import {
  app,
  BrowserWindow,
  MessageChannelMain,
  protocol,
  session,
  type MessagePortMain,
  type Session,
} from "electron"
import {
  pluginSandboxKey,
  pluginSandboxPayloadLimit,
  PluginSandboxError,
  type PluginSandboxCall,
  type PluginSandboxCapabilityScope,
  type PluginSandboxErrorCode,
  type PluginSandboxJson,
  type PluginSandboxNetwork,
} from "./plugin-sandbox-contract"
import { respondToPluginHttps } from "./plugin-network-response"
import { PluginSandboxCapabilityPort } from "./plugin-sandbox-capability-port"
import type { PluginSandboxContext, PluginSandboxLaunch } from "./plugin-sandbox-host"
import {
  PluginSandboxPartitions,
  type PluginSandboxPartitionLease,
} from "./plugin-sandbox-partitions"
import {
  createPluginSandboxResources,
  pluginSandboxScheme,
  type PluginSandboxResources,
} from "./plugin-sandbox-protocol"

const attachChannel = "pigclaude:plugin-sandbox-attach"
const launchTimeoutMs = 12_000
const superviseDelayMs = 200
const httpsHandlers = new WeakSet<Session>()

/** 在主进程启动时注册插件方案与随包预加载位置。 */
export function prepareDesktopPluginSandbox(): PluginSandboxLaunch {
  if (process.type === "browser") registerPluginSandboxScheme()
  return createElectronPluginSandboxLaunch(join(__dirname, "../preload/plugin-sandbox.js"))
}

/** 必须在 Electron ready 前注册方案；不在默认分区挂任何可访问的资源处理器。 */
export function registerPluginSandboxScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: pluginSandboxScheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        bypassCSP: false,
        allowServiceWorkers: false,
        codeCache: false,
      },
    },
  ])
}

/** 创建实际运行能力插件的 Electron 装配器；禁用沙箱时在创建窗口前拒绝。 */
export function createElectronPluginSandboxLaunch(preload: string): PluginSandboxLaunch {
  const partitions = new PluginSandboxPartitions(createSession, clearSession)
  return async (source, crashed, signal) => {
    if (signal.aborted) throw new PluginSandboxError("PLUGIN_CANCELLED")
    if (
      app.commandLine.hasSwitch("no-sandbox") ||
      app.commandLine.hasSwitch("disable-seccomp-filter-sandbox") ||
      process.env.ELECTRON_DISABLE_SANDBOX
    )
      throw new PluginSandboxError("PLUGIN_SANDBOX_UNAVAILABLE")

    const id = randomUUID()
    const resources = createPluginSandboxResources(source, id)
    let lease: PluginSandboxPartitionLease<Session> | undefined
    let window: BrowserWindow | undefined
    let context: WindowContext | undefined
    try {
      lease = await partitions.acquire(pluginSandboxKey(source), signal)
      if (signal.aborted) throw new PluginSandboxError("PLUGIN_CANCELLED")
      const { profile } = lease
      configureSession(
        profile,
        resources,
        source.network?.domains.length
          ? {
              permits: (url) => context?.permitsNetwork(url) === true,
              handle: (request) =>
                context?.forwardNetwork(request, resources.origin) ?? Response.error(),
            }
          : undefined,
      )
      window = new BrowserWindow({
        show: false,
        skipTaskbar: true,
        webPreferences: {
          preload,
          session: profile,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false,
          webSecurity: true,
          webviewTag: false,
          devTools: false,
          backgroundThrottling: false,
          navigateOnDragDrop: false,
        },
      })
      window.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp")
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
      window.webContents.on("will-navigate", (event) => event.preventDefault())
      window.webContents.on("will-frame-navigate", (event) => event.preventDefault())
      window.webContents.on("will-redirect", (event) => event.preventDefault())
      window.webContents.on("will-attach-webview", (event) => event.preventDefault())

      const { port1, port2 } = new MessageChannelMain()
      context = new WindowContext(window, lease.release, port1, crashed)
      await context.start(resources, port2, signal)
      return context
    } catch (error) {
      if (context) await context.close().catch(() => undefined)
      else {
        if (window && !window.isDestroyed()) window.destroy()
        await lease?.release().catch(() => undefined)
      }
      if (error instanceof PluginSandboxError) throw error
      throw new PluginSandboxError("PLUGIN_SANDBOX_UNAVAILABLE")
    }
  }
}

function createSession(): Session {
  const profile = session.fromPartition(`pigclaude-plugin-${randomUUID()}`, { cache: false })
  if (profile.isPersistent()) throw new PluginSandboxError("PLUGIN_SANDBOX_UNAVAILABLE")
  profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  profile.setPermissionCheckHandler(() => false)
  profile.setDevicePermissionHandler(() => false)
  profile.on("will-download", (event) => event.preventDefault())
  return profile
}

function configureSession(
  profile: Session,
  resources: PluginSandboxResources,
  network?: {
    permits(url: string): boolean
    handle(request: Request): Response | Promise<Response>
  },
): void {
  profile.webRequest.onBeforeRequest((details, done) =>
    done({ cancel: !resources.permits(details.url) && network?.permits(details.url) !== true }),
  )
  profile.protocol.handle(pluginSandboxScheme, (request) => resources.handle(request))
  if (network) {
    profile.protocol.handle("https", network.handle)
    httpsHandlers.add(profile)
  }
}

async function clearSession(profile: Session): Promise<void> {
  profile.webRequest.onBeforeRequest((_details, done) => done({ cancel: true }))
  if (profile.protocol.isProtocolHandled(pluginSandboxScheme))
    profile.protocol.unhandle(pluginSandboxScheme)
  if (httpsHandlers.has(profile)) {
    profile.protocol.unhandle("https")
    httpsHandlers.delete(profile)
  }
  const cleanup = await Promise.allSettled([
    profile.closeAllConnections(),
    profile.clearStorageData(),
    profile.clearCache(),
    profile.clearAuthCache(),
  ])
  if (cleanup.some((result) => result.status === "rejected"))
    throw new PluginSandboxError("PLUGIN_SANDBOX_UNAVAILABLE")
}

type PendingCall = {
  id: string
  complete: (result: PluginSandboxJson | PluginSandboxError) => void
  signal: AbortSignal
  network?: PluginSandboxNetwork
  capabilities?: PluginSandboxCapabilityPort
}

class WindowContext implements PluginSandboxContext {
  #attested = false
  #ready = false
  #closed = false
  #boot: { resolve: () => void; reject: (error: PluginSandboxError) => void } | null = null
  #call: PendingCall | null = null
  #closing: Promise<void> | undefined

  constructor(
    private readonly window: BrowserWindow,
    private readonly releasePartition: () => Promise<void>,
    private readonly port: MessagePortMain,
    private readonly crashed: () => void,
  ) {
    window.webContents.on("render-process-gone", () => this.#fatal("PLUGIN_SANDBOX_CRASHED"))
    window.webContents.on("preload-error", () => this.#fatal("PLUGIN_SANDBOX_UNAVAILABLE"))
    window.once("closed", () => this.#fatal("PLUGIN_SANDBOX_CRASHED"))
    port.on("close", () => this.#fatal("PLUGIN_SANDBOX_CRASHED"))
    port.on("message", ({ data }: { data: unknown }) => this.#message(data))
    port.start()
  }

  async start(
    resources: PluginSandboxResources,
    target: MessagePortMain,
    signal: AbortSignal,
  ): Promise<void> {
    const boot = new Promise<void>((resolve, reject) => {
      this.#boot = { resolve, reject }
    })
    const cancel = () => this.#fatal("PLUGIN_CANCELLED")
    const timeout = setTimeout(() => this.#fatal("PLUGIN_SANDBOX_UNAVAILABLE"), launchTimeoutMs)
    let attached = false
    signal.addEventListener("abort", cancel, { once: true })
    try {
      if (signal.aborted) cancel()
      else {
        void this.window
          .loadURL(resources.url)
          .then(() => {
            if (this.#closed) return
            this.window.webContents.postMessage(attachChannel, null, [target])
            attached = true
            this.port.postMessage({
              type: "init",
              entry: resources.entry,
              limit: pluginSandboxPayloadLimit,
            })
          })
          .catch(() => this.#fatal("PLUGIN_SANDBOX_UNAVAILABLE"))
      }
      await boot
    } finally {
      if (!attached) target.close()
      clearTimeout(timeout)
      signal.removeEventListener("abort", cancel)
      this.#boot = null
    }
  }

  async invoke(
    call: PluginSandboxCall,
    timeout: number,
    signal: AbortSignal,
    network?: PluginSandboxNetwork,
    capabilities?: PluginSandboxCapabilityScope,
  ): Promise<PluginSandboxJson> {
    if (signal.aborted) throw new PluginSandboxError("PLUGIN_CANCELLED")
    if (!this.#ready || this.#closed || this.#call)
      throw new PluginSandboxError("PLUGIN_SANDBOX_CRASHED")
    const payload = encodeCall(call)
    const id = randomUUID()
    const scope = new AbortController()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new PluginSandboxError("PLUGIN_TIMEOUT")),
        timeout + superviseDelayMs,
      )
      const cancel = () => {
        try {
          this.port.postMessage({ type: "cancel", id })
        } catch {
          /* 窗口已经退出。 */
        }
        finish(new PluginSandboxError("PLUGIN_CANCELLED"))
      }
      const finish = (result: PluginSandboxJson | PluginSandboxError): void => {
        if (this.#call?.id !== id) return
        this.#call = null
        scope.abort()
        clearTimeout(timer)
        signal.removeEventListener("abort", cancel)
        if (result instanceof PluginSandboxError) {
          reject(result)
          if (result.code === "PLUGIN_TIMEOUT" || result.code === "PLUGIN_CANCELLED")
            void this.close().catch(() => undefined)
        } else resolve(result)
      }
      this.#call = {
        id,
        complete: finish,
        signal: scope.signal,
        ...(network === undefined ? {} : { network }),
        ...(capabilities === undefined
          ? {}
          : {
              capabilities: new PluginSandboxCapabilityPort(capabilities, scope.signal, (reply) =>
                this.port.postMessage({ ...reply, id }),
              ),
            }),
      }
      signal.addEventListener("abort", cancel, { once: true })
      try {
        this.port.postMessage({
          type: "invoke",
          id,
          operation: call.operation,
          payload,
          timeout,
          ...(capabilities === undefined ? {} : { capabilities: capabilities.methods }),
        })
      } catch {
        finish(new PluginSandboxError("PLUGIN_SANDBOX_CRASHED"))
      }
    })
  }

  permitsNetwork(url: string): boolean {
    return !this.#closed && this.#call?.network?.permits(url) === true
  }

  forwardNetwork(request: Request, origin: string): Response | Promise<Response> {
    const call = this.#call
    return this.#closed || call?.network === undefined
      ? Response.error()
      : respondToPluginHttps(request, call.network, call.signal, origin)
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing
    this.#closed = true
    const error = new PluginSandboxError("PLUGIN_SANDBOX_CLOSED")
    this.#boot?.reject(error)
    this.#call?.complete(error)
    this.port.close()
    if (!this.window.isDestroyed()) this.window.destroy()
    this.#closing = this.releasePartition()
    return this.#closing
  }

  #message(data: unknown): void {
    if (this.#closed || !record(data)) return
    switch (data.type) {
      case "attestation":
        if (this.#boot && data.sandboxed === true) this.#attested = true
        else this.#fatal("PLUGIN_SANDBOX_UNAVAILABLE")
        return
      case "ready":
        if (!this.#boot || !this.#attested) return this.#fatal("PLUGIN_SANDBOX_UNAVAILABLE")
        this.#ready = true
        this.#boot.resolve()
        return
      case "fatal":
        this.#fatal(
          data.code === "PLUGIN_LOAD_FAILED" || data.code === "PLUGIN_SANDBOX_UNAVAILABLE"
            ? data.code
            : "PLUGIN_SANDBOX_CRASHED",
        )
        return
      case "capability":
        if (this.#call && data.id === this.#call.id) this.#call.capabilities?.receive(data)
        return
      case "result":
        if (this.#call && data.id === this.#call.id) this.#call.complete(decodeResult(data.payload))
        return
      case "failure":
        if (this.#call && data.id === this.#call.id)
          this.#call.complete(new PluginSandboxError(callError(data.code)))
    }
  }

  #fatal(code: PluginSandboxErrorCode): void {
    if (this.#closed) return
    const error = new PluginSandboxError(code)
    this.#boot?.reject(error)
    this.#call?.complete(error)
    void this.close().catch(() => undefined)
    if (this.#ready) this.crashed()
  }
}

function record(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null
}

function encodeCall(call: PluginSandboxCall): string {
  try {
    const payload = JSON.stringify(call.input)
    if (
      !call.operation ||
      call.operation.length > 128 ||
      typeof payload !== "string" ||
      Buffer.byteLength(payload) > pluginSandboxPayloadLimit
    )
      throw new Error()
    return payload
  } catch {
    throw new PluginSandboxError("PLUGIN_PAYLOAD_INVALID")
  }
}

function decodeResult(payload: unknown): PluginSandboxJson | PluginSandboxError {
  try {
    if (typeof payload !== "string" || payload.length > pluginSandboxPayloadLimit) throw new Error()
    return JSON.parse(payload) as PluginSandboxJson
  } catch {
    return new PluginSandboxError("PLUGIN_RESULT_INVALID")
  }
}

function callError(code: unknown): PluginSandboxErrorCode {
  return code === "PLUGIN_TIMEOUT" ||
    code === "PLUGIN_CANCELLED" ||
    code === "PLUGIN_RESULT_INVALID"
    ? code
    : "PLUGIN_EXECUTION_FAILED"
}
