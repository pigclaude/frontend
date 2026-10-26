// 负责注册 Claude 账号和代理的 IPC，校验 renderer 输入并转发脱敏结果。

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import {
  isClaudeFingerprintView,
  type ClaudeFingerprintView,
} from "@pigclaude/contracts/claude-account"
import type {
  AuthorizeClaudeAccountInput,
  ClaudeAccountService,
  UpdateClaudeAccountInput,
} from "./account-service"
import { ClaudeAccountError } from "./errors"
import type { ProxyService } from "./proxy-service"

/** IPC 注册依赖。getService 在服务尚未装配时返回 null。 */
export type ClaudeIpcOptions = {
  getService: () => ClaudeAccountService | null
  getProxyService: () => ProxyService | null
  isTrusted: (event: IpcMainInvokeEvent) => boolean
}

/** 注册账号、代理和出口核对 IPC。保证写操作只接受主窗口当前 frame。 */
export function registerClaudeIpc(options: ClaudeIpcOptions): void {
  ipcMain.handle("pigclaude:claude-accounts-list", async () => {
    return (await options.getService()?.list()) ?? []
  })
  ipcMain.handle("pigclaude:claude-accounts-authorize", async (event, value: unknown) => {
    assertTrusted(options, event)
    const service = requireService(options)
    return service.authorize(readAuthorizeInput(value))
  })
  ipcMain.handle("pigclaude:claude-accounts-cancel", async (event) => {
    assertTrusted(options, event)
    await requireService(options).cancel()
  })
  ipcMain.handle("pigclaude:claude-accounts-update", async (event, value: unknown) => {
    assertTrusted(options, event)
    return requireService(options).update(readUpdateInput(value))
  })
  ipcMain.handle("pigclaude:claude-accounts-remove", async (event, value: unknown) => {
    assertTrusted(options, event)
    await requireService(options).remove(readAccountId(value))
  })
  ipcMain.handle("pigclaude:proxies-list", async () => {
    return (await options.getProxyService()?.list()) ?? []
  })
  ipcMain.handle("pigclaude:proxies-save", async (event, value: unknown) => {
    assertTrusted(options, event)
    return requireProxyService(options).save(readProxyInput(value))
  })
  ipcMain.handle("pigclaude:proxies-remove", async (event, value: unknown) => {
    assertTrusted(options, event)
    await requireProxyService(options).remove(readProxyId(value))
  })
  ipcMain.handle("pigclaude:proxies-test", async (event, value: unknown) => {
    assertTrusted(options, event)
    return requireProxyService(options).test(readProxyId(value))
  })
  ipcMain.handle("pigclaude:egress-check", async (event, value: unknown) => {
    assertTrusted(options, event)
    return requireProxyService(options).checkEgress(readProxyId(value))
  })
}

function assertTrusted(options: ClaudeIpcOptions, event: IpcMainInvokeEvent): void {
  if (!options.isTrusted(event)) throw new Error("UNTRUSTED_REQUEST")
}

function requireService(options: ClaudeIpcOptions): ClaudeAccountService {
  const service = options.getService()
  if (service === null) throw new ClaudeAccountError("UNEXPECTED_ERROR", "账号服务尚未准备好")
  return service
}

function requireProxyService(options: ClaudeIpcOptions): ProxyService {
  const service = options.getProxyService()
  if (service === null) throw new ClaudeAccountError("UNEXPECTED_ERROR", "代理服务尚未准备好")
  return service
}

function readAuthorizeInput(value: unknown): AuthorizeClaudeAccountInput {
  if (!isRecord(value)) throw invalidInput()
  const displayName = readString(value.displayName)
  const fingerprint = value.fingerprint
  if (displayName === null || !isClaudeFingerprintView(fingerprint)) {
    throw invalidInput()
  }
  return {
    accountId: readOptionalString(value.accountId),
    displayName,
    proxyId: readAuthorizeProxyId(value.proxyId),
    fingerprint: fingerprint as ClaudeFingerprintView,
  }
}

function readUpdateInput(value: unknown): UpdateClaudeAccountInput {
  if (!isRecord(value)) throw invalidInput()
  const accountId = readString(value.accountId)
  if (accountId === null) throw invalidInput()
  const displayName = readOptionalString(value.displayName)
  const enabled = value.enabled
  const proxyId = readUpdateProxyId(value.proxyId)
  const fingerprint = value.fingerprint
  if (enabled !== undefined && typeof enabled !== "boolean") throw invalidInput()
  if (fingerprint !== undefined && !isClaudeFingerprintView(fingerprint)) throw invalidInput()
  return {
    accountId,
    ...(displayName === undefined ? {} : { displayName }),
    ...(enabled === undefined ? {} : { enabled }),
    ...(proxyId === undefined ? {} : { proxyId }),
    ...(fingerprint === undefined ? {} : { fingerprint: fingerprint as ClaudeFingerprintView }),
  }
}

/** 解析授权请求的 proxyId。保证 null 和空字符串都表示直连，缺省或其他类型不合法。 */
function readAuthorizeProxyId(value: unknown): string | null {
  if (value === null || value === "") return null
  if (typeof value === "string") return value
  throw invalidInput()
}

/** 解析更新请求的 proxyId。保证 undefined 保持不变，null 和空字符串表示解绑。 */
function readUpdateProxyId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === "") return null
  if (typeof value === "string") return value
  throw invalidInput()
}

function readAccountId(value: unknown): string {
  const id = readString(value)
  if (id === null) throw invalidInput()
  return id
}

function readProxyInput(value: unknown): { id?: string; name: string; url: string } {
  if (!isRecord(value)) throw invalidInput()
  const name = readString(value.name)
  const url = readString(value.url)
  if (name === null || url === null) throw invalidInput()
  const id = readOptionalString(value.id)
  return { ...(id === undefined ? {} : { id }), name, url }
}

function readProxyId(value: unknown): string {
  return readAccountId(value)
}

function invalidInput(): ClaudeAccountError {
  return new ClaudeAccountError("INVALID_INPUT", "请求参数不合法")
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
