// 装配隐藏的沙箱窗口和专用内存分区，验证预加载与 Worker 后才接受调用。
import { randomUUID } from "node:crypto"
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
  pluginSandboxPayloadLimit,
  PluginSandboxError,
  type PluginSandboxCall,
  type PluginSandboxErrorCode,
  type PluginSandboxJson,
} from "./plugin-sandbox-contract"
import type { PluginSandboxContext, PluginSandboxLaunch } from "./plugin-sandbox-host"
import {
  createPluginSandboxResources,
  pluginSandboxScheme,
  type PluginSandboxResources,
} from "./plugin-sandbox-protocol"

const attachChannel = "pigclaude:plugin-sandbox-attach"
const launchTimeoutMs = 12_000
const superviseDelayMs = 200

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
    let profile: Session | undefined
    let window: BrowserWindow | undefined
    let context: WindowContext | undefined
    try {
      profile = session.fromPartition(`pigclaude-plugin-${id}`, { cache: false })
      configureSession(profile, resources)
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
      context = new WindowContext(window, profile, port1, crashed)
      await context.start(resources, port2, signal)
      return context
    } catch (error) {
      if (context) await context.close()
      else {
        if (window && !window.isDestroyed()) window.destroy()
        if (profile) await clearSession(profile)
      }
      if (error instanceof PluginSandboxError) throw error
      throw new PluginSandboxError("PLUGIN_SANDBOX_UNAVAILABLE")
    }
  }
}

function configureSession(profile: Session, resources: PluginSandboxResources): void {
  if (profile.isPersistent()) throw new PluginSandboxError("PLUGIN_SANDBOX_UNAVAILABLE")
  profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  profile.setPermissionCheckHandler(() => false)
  profile.setDevicePermissionHandler(() => false)
  profile.on("will-download", (event) => event.preventDefault())
  profile.webRequest.onBeforeRequest((details, done) =>
    done({ cancel: !resources.permits(details.url) }),
  )
  profile.protocol.handle(pluginSandboxScheme, (request) => resources.handle(request))
}

async function clearSession(profile: Session): Promise<void> {
  profile.webRequest.onBeforeRequest((_details, done) => done({ cancel: true }))
  if (profile.protocol.isProtocolHandled(pluginSandboxScheme))
    profile.protocol.unhandle(pluginSandboxScheme)
  await Promise.allSettled([
    profile.closeAllConnections(),
    profile.clearStorageData(),
    profile.clearCache(),
  ])
}

type PendingCall = {
  id: string
  complete: (result: PluginSandboxJson | PluginSandboxError) => void
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
    private readonly profile: Session,
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
  ): Promise<PluginSandboxJson> {
    if (signal.aborted) throw new PluginSandboxError("PLUGIN_CANCELLED")
    if (!this.#ready || this.#closed || this.#call)
      throw new PluginSandboxError("PLUGIN_SANDBOX_CRASHED")
    const payload = encodeCall(call)
    const id = randomUUID()
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
        clearTimeout(timer)
        signal.removeEventListener("abort", cancel)
        if (result instanceof PluginSandboxError) {
          reject(result)
          if (result.code === "PLUGIN_TIMEOUT" || result.code === "PLUGIN_CANCELLED")
            void this.close().catch(() => undefined)
        } else resolve(result)
      }
      this.#call = { id, complete: finish }
      signal.addEventListener("abort", cancel, { once: true })
      try {
        this.port.postMessage({ type: "invoke", id, operation: call.operation, payload, timeout })
      } catch {
        finish(new PluginSandboxError("PLUGIN_SANDBOX_CRASHED"))
      }
    })
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing
    this.#closed = true
    const error = new PluginSandboxError("PLUGIN_SANDBOX_CLOSED")
    this.#boot?.reject(error)
    this.#call?.complete(error)
    this.port.close()
    if (!this.window.isDestroyed()) this.window.destroy()
    this.#closing = clearSession(this.profile)
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
      payload.length > pluginSandboxPayloadLimit
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
