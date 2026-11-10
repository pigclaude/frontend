// 负责验证 Claude IPC 对授权、更新和 CLI 导入请求的解析，以及导入通道的信任校验和返回值脱敏。

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeAccountView, ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import type { ClaudeAccountService } from "./account-service"
import type { ProxyService } from "./proxy-service"
import { ClaudeAccountError } from "./errors"
import { readAuthorizeInput, readImportInput, readUpdateInput, registerClaudeIpc } from "./ipc"

const ipcHandlers = vi.hoisted(
  () => new Map<string, (event: unknown, value?: unknown) => Promise<unknown>>(),
)

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, value?: unknown) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler)
    },
  },
}))

const fingerprint: ClaudeFingerprintView = {
  seed: "123456",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: "1",
  clientRectsNoise: "1",
}

const importedView: ClaudeAccountView = {
  id: "acc-imported",
  displayName: "CLI 账号",
  enabled: true,
  email: "cli@example.com",
  subscriptionType: "pro",
  needsReauth: false,
  credentialExpiresAt: 4_102_444_800_000,
  exhaustedUntil: null,
  proxyId: null,
  fingerprint,
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
}

function expectInvalidInput(run: () => unknown): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ClaudeAccountError)
    expect(error).toMatchObject({ code: "INVALID_INPUT" })
    return
  }
  throw new Error("expected INVALID_INPUT")
}

describe("readAuthorizeInput", () => {
  it("不接受旧的可选检测入口参数", () => {
    const input = { displayName: "工作账号", proxyId: "p1", fingerprint }
    expect(readAuthorizeInput(input)).not.toHaveProperty("preflight")
    for (const preflight of ["checkcc", "other", "https://example.com", true, null]) {
      expectInvalidInput(() => readAuthorizeInput({ ...input, preflight }))
    }
  })

  it.each([
    [null, null],
    ["", null],
    ["p1", "p1"],
  ] as const)("parses proxyId %j as %j", (proxyId, expected) => {
    const parsed = readAuthorizeInput({ displayName: "工作账号", proxyId, fingerprint })
    expect(parsed.proxyId).toBe(expected)
  })

  it("rejects a missing proxyId", () => {
    expectInvalidInput(() => readAuthorizeInput({ displayName: "工作账号", fingerprint }))
  })

  it.each([
    ["number", 42],
    ["object", {}],
    ["array", []],
  ] as const)("rejects a %s proxyId", (_label, proxyId) => {
    expectInvalidInput(() => readAuthorizeInput({ displayName: "工作账号", proxyId, fingerprint }))
  })
})

describe("readUpdateInput", () => {
  it("omits proxyId when it is undefined", () => {
    expect(readUpdateInput({ accountId: "acc-1" })).not.toHaveProperty("proxyId")
    expect(readUpdateInput({ accountId: "acc-1", proxyId: undefined })).not.toHaveProperty(
      "proxyId",
    )
  })

  it.each([
    [null, null],
    ["", null],
    ["p1", "p1"],
  ] as const)("parses proxyId %j as %j", (proxyId, expected) => {
    const parsed = readUpdateInput({ accountId: "acc-1", proxyId })
    expect(parsed.proxyId).toBe(expected)
  })

  it.each([
    ["number", 42],
    ["object", {}],
    ["array", []],
  ] as const)("rejects a %s proxyId", (_label, proxyId) => {
    expectInvalidInput(() => readUpdateInput({ accountId: "acc-1", proxyId }))
  })
})

describe("readImportInput", () => {
  it("requires confirmCopy to be exactly true", () => {
    expect(readImportInput({ confirmCopy: true })).toEqual({ confirmCopy: true })
    for (const value of [undefined, null, false, "true", 1, {}, []]) {
      expectInvalidInput(() => readImportInput({ confirmCopy: value }))
    }
    expectInvalidInput(() => readImportInput(null))
  })

  it("trims a provided displayName and rejects blank or non-string values", () => {
    expect(readImportInput({ confirmCopy: true, displayName: " 工作账号 " })).toEqual({
      confirmCopy: true,
      displayName: "工作账号",
    })
    for (const displayName of ["", "   ", 42, null, {}, []]) {
      expectInvalidInput(() => readImportInput({ confirmCopy: true, displayName }))
    }
  })
})

describe("claude CLI import IPC", () => {
  beforeEach(() => {
    ipcHandlers.clear()
  })

  it("rejects an untrusted sender without calling the service", async () => {
    const service = fakeService()
    register(service, false)

    await expect(invokeImport({ confirmCopy: true })).rejects.toThrow("UNTRUSTED_REQUEST")
    expect(service.importFromClaudeCli).not.toHaveBeenCalled()
  })

  it("rejects confirmCopy that is not true", async () => {
    const service = fakeService()
    register(service, true)

    await expect(invokeImport({ confirmCopy: false })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    })
    expect(service.importFromClaudeCli).not.toHaveBeenCalled()
  })

  it("rejects an invalid displayName", async () => {
    const service = fakeService()
    register(service, true)

    await expect(invokeImport({ confirmCopy: true, displayName: 42 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    })
    expect(service.importFromClaudeCli).not.toHaveBeenCalled()
  })

  it("passes the parsed input and returns a view without token fields", async () => {
    const service = fakeService()
    register(service, true)

    const view = await invokeImport({
      confirmCopy: true,
      displayName: " 工作账号 ",
      browserProfileId: "profile-1",
    })

    expect(service.importFromClaudeCli).toHaveBeenCalledWith({
      confirmCopy: true,
      displayName: "工作账号",
      browserProfileId: "profile-1",
    })
    expect(view).toEqual(importedView)
    expect(view).not.toHaveProperty("accessToken")
    expect(view).not.toHaveProperty("refreshToken")
  })

  it("rejects a service result that leaks credential fields", async () => {
    const service = fakeService({
      ...importedView,
      accessToken: "leaked-access-token",
    } as ClaudeAccountView)
    register(service, true)

    await expect(
      invokeImport({ confirmCopy: true, browserProfileId: "profile-1" }),
    ).rejects.toMatchObject({
      code: "UNEXPECTED_ERROR",
      message: "导入结果无效",
    })
  })
})

describe("验证并保存代理 IPC", () => {
  beforeEach(() => ipcHandlers.clear())

  it("只接受可信窗口的请求，并把地址交给真实代理服务", async () => {
    const saveVerified = vi.fn(async () => ({ id: "p1" }))
    let trusted = false
    registerClaudeIpc({
      getService: () => null,
      getProxyService: () => ({ saveVerified }) as unknown as ProxyService,
      isTrusted: () => trusted,
    })
    const handler = ipcHandlers.get("pigclaude:proxies-save-verified")
    if (handler === undefined) throw new Error("proxy handler not registered")
    const input = { name: "测试代理", url: "http://user:pass@proxy.test:8000" }
    await expect(handler({}, input)).rejects.toThrow("UNTRUSTED_REQUEST")
    expect(saveVerified).not.toHaveBeenCalled()
    trusted = true
    await expect(handler({}, input)).resolves.toEqual({ id: "p1" })
    expect(saveVerified).toHaveBeenCalledWith(input)
  })
})

describe("产品授权只接受配置引用", () => {
  it.each(["", "   "])("拒绝空引用 %j 携带旧指纹退回兼容入口", async (browserProfileId) => {
    ipcHandlers.clear()
    const authorize = vi.fn(async () => importedView)
    const service = { ...fakeService(), authorize }
    register(service, true)
    const handler = ipcHandlers.get("pigclaude:claude-accounts-authorize")
    if (!handler) throw new Error("授权入口未注册")
    await expect(
      handler(
        {},
        {
          displayName: "账号",
          browserProfileId,
          fingerprint: importedView.fingerprint,
          proxyId: null,
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(authorize).not.toHaveBeenCalled()
  })
})

function fakeService(result: ClaudeAccountView = importedView): {
  importFromClaudeCli: ReturnType<typeof vi.fn>
} {
  return {
    importFromClaudeCli: vi.fn(async () => result),
  }
}

function register(
  service: { importFromClaudeCli: ReturnType<typeof vi.fn> },
  trusted: boolean,
): void {
  registerClaudeIpc({
    getService: () => service as unknown as ClaudeAccountService,
    getProxyService: () => null,
    isTrusted: () => trusted,
  })
}

async function invokeImport(input: unknown): Promise<unknown> {
  const handler = ipcHandlers.get("pigclaude:claude-accounts-import-cli")
  if (handler === undefined) throw new Error("import handler not registered")
  return handler({}, input)
}
