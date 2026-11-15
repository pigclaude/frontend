// 定义能力插件宿主接受的模块、调用与唯一能跨消息端口传递的数据。

/** 插件调用只携带 JSON 数据，不能把进程对象、文件句柄或消息端口交给插件。 */
export type PluginSandboxJson =
  | null
  | string
  | number
  | boolean
  | readonly PluginSandboxJson[]
  | { readonly [key: string]: PluginSandboxJson }

/** 已安装插件的模块快照，模块路径是包内相对路径，出口标识只用于主进程隔离实例。 */
export type PluginSandboxSource = {
  readonly pluginId: string
  readonly revision: string
  readonly egressId: string
  readonly entry: string
  readonly modules: Readonly<Record<string, string>>
  /** 主进程为当次调用核准的网络能力；缺省时分区禁网。 */
  readonly network?: PluginSandboxNetwork
}

/** 主进程持有的出口与域名授权。Worker 只看到 HTTPS 请求和响应。 */
export type PluginSandboxNetwork = {
  readonly egressId: string
  readonly domains: readonly string[]
  permits(url: string): boolean
  forward(request: Request, signal: AbortSignal): Promise<Response>
}

/** 主进程分别提供清单声明和安装时用户确认的域名。 */
export type PluginNetworkAccess = {
  declaredDomains: readonly string[]
  approvedDomains: readonly string[]
}

/** 实例与内存分区按同一组插件版本和出口标识隔离。 */
export function pluginSandboxKey(source: PluginSandboxSource): string {
  return JSON.stringify([
    source.pluginId,
    source.revision,
    source.network?.egressId ?? source.egressId,
    source.network?.domains ?? [],
  ])
}

/** Worker 将操作名与输入交给入口模块的默认导出。 */
export type PluginSandboxCall = { readonly operation: string; readonly input: PluginSandboxJson }

/** Worker 在当前调用中可申请的白名单操作。 */
export type PluginSandboxCapabilityMethod =
  | "storage.get"
  | "storage.set"
  | "storage.delete"
  | "secrets.get"
  | "secrets.set"
  | "secrets.delete"
  | "workspace.readText"
  | "notifications.show"
  | "composer.insert"

/** 一次调用可以使用的能力与主进程实现，只有名称和 JSON 跨过端口。 */
export type PluginSandboxCapabilityScope = {
  readonly methods: readonly PluginSandboxCapabilityMethod[]
  request(
    method: PluginSandboxCapabilityMethod,
    args: readonly PluginSandboxJson[],
    signal: AbortSignal,
  ): Promise<PluginSandboxJson>
}

/** 调用方可以取消、限制时间或为本次调用附加已经授权的能力。 */
export type PluginSandboxCallOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  capabilities?: PluginSandboxCapabilityScope
}

/** 进程边界只返回固定错误码，不转发 Chromium 错误、文件路径、堆栈或插件抛出的字符串。 */
export type PluginSandboxErrorCode =
  | "PLUGIN_BUNDLE_INVALID"
  | "PLUGIN_SANDBOX_UNAVAILABLE"
  | "PLUGIN_SANDBOX_CLOSED"
  | "PLUGIN_SANDBOX_CRASHED"
  | "PLUGIN_SANDBOX_BACKOFF"
  | "PLUGIN_EGRESS_UNAVAILABLE"
  | "PLUGIN_LOAD_FAILED"
  | "PLUGIN_EXECUTION_FAILED"
  | "PLUGIN_TIMEOUT"
  | "PLUGIN_CANCELLED"
  | "PLUGIN_PAYLOAD_INVALID"
  | "PLUGIN_RESULT_INVALID"
  | "PLUGIN_CAPABILITY_DENIED"

/** 主进程使用固定错误码报告沙箱故障。 */
export class PluginSandboxError extends Error {
  /** 不附带插件自定义消息或堆栈。 */
  constructor(readonly code: PluginSandboxErrorCode) {
    super(code)
    this.name = "PluginSandboxError"
  }
}

/** JSON 消息的文本上限，与 Worker 的结果限制一致。 */
export const pluginSandboxPayloadLimit = 512 * 1024
