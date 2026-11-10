// 汇合原生 CLI 与各条中转传输的实际采样，不把本机快照或闭源厂商声明当作在线证明。

import { environmentCheckItem } from "./environment-policy"
import { createNativeEvidence } from "./native-environment-evidence"
import type { NativeEnvironmentEvidence } from "./environment-check-model"
import type {
  NativeEnvironmentDiagnostics,
  NativeEnvironmentInput,
} from "./native-environment-model"
import { probeNativeCli } from "./native-cli-probe"
import { NativeDiagnosticCleanupError } from "./native-diagnostic-cleanup"
import { probeNativeRoutes } from "./native-route-probe"
import { defaultEnvironmentExitUrl } from "./environment-targets"
import { normalizeSessionLocale, normalizeSessionTimezone } from "../session/session-locale"
import { ClaudeAccountError } from "./errors"

/** 可信宿主提供的固定原生资源和系统基线；测试可替换为本机合成目标。 */
export type NativeEnvironmentOptions = {
  binary?: string
  exitTarget?: string
  systemLocale?: () => string
  systemTimezone?: () => string
  diagnosticTimeoutMs?: number
  readAvailableLocales?: (signal: AbortSignal) => Promise<readonly string[]>
}

/** 串行执行授权诊断，所有权和失败清理跨请求保持，禁止重叠运行或带病重试。 */
export class NativeEnvironmentInspector implements NativeEnvironmentDiagnostics {
  readonly #options: NativeEnvironmentOptions
  readonly #controllers = new Set<AbortController>()
  #tail: Promise<unknown> = Promise.resolve()
  #blocked: (() => Promise<void>) | undefined
  #closed = false

  /** 绑定可信主进程配置，不从网页接受资源路径或检测服务地址。 */
  constructor(options: NativeEnvironmentOptions = {}) {
    const timeout = options.diagnosticTimeoutMs ?? 30_000
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000)
      throw new Error("原生诊断超时配置无效")
    this.#options = options
  }

  /** 本轮返回原生启动/合成协议及分路出口证据，取消后不继续产生可放行报告。 */
  inspect(input: NativeEnvironmentInput): Promise<NativeEnvironmentEvidence> {
    const task = this.#tail
      .catch(() => undefined)
      .then(async () => {
        input.signal.throwIfAborted()
        if (this.#closed) throw new Error("原生检测器已关闭")
        if (this.#blocked) {
          await this.#blocked()
          this.#blocked = undefined
        }
        return this.#inspect(input)
      })
    this.#tail = task
    return task
  }

  async #inspect(input: NativeEnvironmentInput): Promise<NativeEnvironmentEvidence> {
    if (process.env["NODE_TLS_REJECT_UNAUTHORIZED"] === "0")
      throw new ClaudeAccountError("ENVIRONMENT_CHECK_FAILED", "原生自检要求保留 TLS 证书校验")
    const mode = input.proxyUrl === null ? "system" : "bound"
    const controller = new AbortController()
    this.#controllers.add(controller)
    try {
      const signal = AbortSignal.any([
        input.signal,
        controller.signal,
        AbortSignal.timeout(this.#options.diagnosticTimeoutMs ?? 30_000),
      ])
      const locale = normalizeSessionLocale(
        input.fingerprint.lang || this.#options.systemLocale?.(),
      )
      const timezone = normalizeSessionTimezone(
        input.fingerprint.timezone || this.#options.systemTimezone?.(),
      )
      const [cli, routes] = await Promise.allSettled([
        probeNativeCli({
          timezone,
          locale,
          signal,
          binary: this.#options.binary,
          readAvailableLocales: this.#options.readAvailableLocales,
        }),
        probeNativeRoutes(
          { ...input, signal },
          this.#options.exitTarget ?? defaultEnvironmentExitUrl,
        ),
      ])
      const pending = [cli, routes].flatMap((result) =>
        result.status === "rejected" && result.reason instanceof NativeDiagnosticCleanupError
          ? [result.reason.cleanup]
          : [],
      )
      if (pending.length) {
        this.#blocked = async () => {
          const results = await Promise.allSettled(pending.map((cleanup) => cleanup()))
          if (results.some((result) => result.status === "rejected"))
            throw new Error("原生诊断清理仍未完成")
        }
        throw new NativeDiagnosticCleanupError(this.#blocked)
      }
      input.signal.throwIfAborted()
      controller.signal.throwIfAborted()
      const facts = cli.status === "fulfilled" ? cli.value : null
      const launchPassed =
        !!facts?.launched &&
        facts.configurationPrivate &&
        facts.localeAvailable &&
        facts.launchEnvironmentMatches &&
        facts.legacyPreloadRemoved &&
        facts.nativeCredentialIsPlaceholder
      const protocolPassed = facts?.protocolPreserved === true
      const ips = routes.status === "fulfilled" ? routes.value : { daemonIp: null, refreshIp: null }
      const complete = ips.daemonIp !== null && ips.refreshIp !== null
      const matched =
        complete &&
        ips.daemonIp === ips.refreshIp &&
        (input.expectedExitIp === null || ips.daemonIp === input.expectedExitIp)
      const checks = [
        environmentCheckItem(
          "cli-launch",
          mode,
          facts === null ? "unknown" : launchPassed ? "passed" : "failed",
          {
            expected: `官方原生 CLI；独立配置；时区 ${timezone}、语言 ${locale}；无真实凭据`,
            actual: facts
              ? `版本 ${facts.version}；${facts.platform}；LANG/LC_ALL ${facts.locale}；实际进程与启动材料${launchPassed ? "核对一致" : "未通过核对"}`
              : "未能完成实际原生 CLI 采样",
            evidence:
              "生产会话适配器 + 官方 SDK native spawn；临时独立配置和占位 token；POSIX 平台核对系统可用 locale；NODE_OPTIONS 由 SDK 删除；合成请求仅到本机",
            remedy: launchPassed
              ? "无需处理；不把启动变量视为内部 Intl 的直接观测"
              : "核对官方 CLI 资源、语言设置与本机诊断服务后重新检测",
          },
        ),
        environmentCheckItem(
          "cli-protocol",
          mode,
          facts === null ? "unknown" : protocolPassed ? "passed" : "failed",
          {
            expected:
              "实际 CLI 请求经生产 daemon 后正文与客户端标识保留；本机会话头移除，认证按设计替换",
            actual: facts
              ? `合成正文 ${facts.bodyBytes} 字节；metadata ${facts.metadataPresent ? "存在" : "未出现"}；协议${protocolPassed ? "核对一致" : "未通过核对"}`
              : "没有取得实际 native 请求与中转两端记录",
            evidence:
              "本机记录端 → 实际 LocalDaemon → 独占合成代理 → 本机假端点；只比较原值，不导出正文或设备标识，不调用真实模型",
            remedy: protocolPassed
              ? "无需处理"
              : "检查本机服务与当前 SDK/CLI 协议；不能以手写请求代替真实 native 采样",
          },
        ),
        environmentCheckItem(
          "native-routes",
          mode,
          !complete ? "unknown" : matched ? "passed" : "failed",
          {
            expected: "daemon 与刷新器各自实际客户端的 IPv4 与本次账号网络一致",
            actual: `daemon ${ips.daemonIp ?? "缺少有效 IPv4"}；刷新传输 ${ips.refreshIp ?? "缺少有效 IPv4"}`,
            evidence: `${mode === "bound" ? "保留当前绑定代理，无直连回退" : "两条路径使用系统网络"}；固定 HTTPS 原始出口查询；刷新只测试传输，不使用真实 refresh token`,
            remedy: matched
              ? "无需处理；真实 token 刷新留待人工账号验收"
              : "核对当前代理和各客户端路径，修复后重新检测",
          },
        ),
        environmentCheckItem("cli-intl", mode, "unknown", {
          expected: "区分实际 native 内部 Intl 与启动配置",
          actual: "当前原生 CLI 内部 Intl 未取得直接观测",
          evidence:
            "本期未从原生进程采集内部 Intl；没有使用 Node preload、子进程 Intl 或 Bash date 冒充 native 内部结果",
          remedy: "本轮只对实际启动材料和协议负责；内部 Intl 保持未覆盖说明",
        }),
      ]
      return createNativeEvidence(checks, Date.now(), matched ? ips.daemonIp : null, {
        locale,
        timezone,
      })
    } finally {
      this.#controllers.delete(controller)
    }
  }

  /** 停止本类拥有的在途诊断，并重试尚未确认的资源清理。 */
  async dispose(): Promise<void> {
    this.#closed = true
    for (const controller of this.#controllers) controller.abort()
    await this.settle()
  }

  /** 等待并重试本轮清理，不关闭检查器；取消完成前不能忽略失败句柄。 */
  async settle(): Promise<void> {
    await this.#tail.catch(() => undefined)
    if (this.#blocked) {
      await this.#blocked()
      this.#blocked = undefined
    }
  }
}
