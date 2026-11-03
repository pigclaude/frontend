// 负责验证账号控制器的错误：主进程错误去掉 Electron 前缀后显示，操作后的刷新不清掉它，下一次操作开始时才清空。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeAccountView, ProxyView } from "@pigclaude/contracts/claude-account"
import { useClaudeAccounts, type ClaudeAccountsController } from "./use-claude-accounts"

let root: Root
let container: HTMLDivElement
let controller: ClaudeAccountsController | null = null

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  controller = null
  delete window.pigclaude
  vi.unstubAllGlobals()
})

function Probe() {
  controller = useClaudeAccounts()
  return null
}

/** 主进程抛出 ClaudeAccountError 时，renderer 收到的错误。 */
function remoteError(channel: string, message: string): Error {
  return new Error(`Error invoking remote method '${channel}': ClaudeAccountError: ${message}`)
}

function installBridge(overrides: {
  remove?: (accountId: string) => Promise<void>
  save?: (input: { name: string; url: string }) => Promise<ProxyView>
  importFromClaudeCli?: (input: {
    confirmCopy: boolean
    displayName?: string
  }) => Promise<ClaudeAccountView>
}): { list: ReturnType<typeof vi.fn>; importFromClaudeCli: ReturnType<typeof vi.fn> } {
  const list = vi.fn(async (): Promise<ClaudeAccountView[]> => [])
  const proxy: ProxyView = { id: "p1", name: "LA-01", url: "http://127.0.0.1:1", lastTest: null }
  const imported: ClaudeAccountView = {
    id: "acc-imported",
    displayName: "CLI 账号",
    enabled: true,
    email: "cli@example.com",
    subscriptionType: "pro",
    needsReauth: false,
    credentialExpiresAt: Date.now() + 60_000,
    proxyId: null,
    fingerprint: {
      seed: "",
      brand: "Chrome",
      platform: "macos",
      lang: "",
      timezone: "",
      canvasNoise: "",
      clientRectsNoise: "",
    },
    createdAt: "2026-10-26T00:00:00.000Z",
    updatedAt: "2026-10-26T00:00:00.000Z",
  }
  const importFromClaudeCli = vi.fn(overrides.importFromClaudeCli ?? (async () => imported))
  window.pigclaude = {
    platform: "darwin",
    claudeAccounts: {
      list,
      authorize: async () => {
        throw new Error("not used")
      },
      cancelAuthorization: async () => undefined,
      update: async () => {
        throw new Error("not used")
      },
      remove: overrides.remove ?? (async () => undefined),
      importFromClaudeCli,
      subscribe: () => () => undefined,
    },
    proxies: {
      list: async () => [proxy],
      save: overrides.save ?? (async () => proxy),
      remove: async () => undefined,
      test: async () => proxy,
    },
    egress: { check: async () => ({ ok: true, ip: "203.0.113.42" }) },
  }
  return { list, importFromClaudeCli }
}

describe("useClaudeAccounts errors", () => {
  it("does not let an older proxy refresh erase a newly verified proxy", async () => {
    installBridge({})
    const proxies = window.pigclaude?.proxies
    if (!proxies) throw new Error("proxy bridge missing")
    let resolveOld: (items: ProxyView[]) => void = () => undefined
    proxies.list = () =>
      new Promise((resolve) => {
        resolveOld = resolve
      })
    const verified: ProxyView = {
      id: "verified",
      name: "已验证代理",
      url: "http://proxy.test:8000",
      lastTest: { ok: true, ip: "203.0.113.42", latencyMs: 1, testedAt: "2026-11-04" },
    }
    proxies.saveVerified = async () => verified
    await act(async () => root.render(createElement(Probe)))
    await act(async () => controller?.addVerifiedProxy({ name: verified.name, url: verified.url }))
    await act(async () => resolveOld([]))
    expect(controller?.proxies).toEqual([verified])
  })

  it("shows the main-process message without the Electron prefix and keeps it after refresh", async () => {
    const { list } = installBridge({
      remove: async () => {
        throw remoteError("pigclaude:claude-accounts-remove", "删除浏览器配置目录失败")
      },
    })
    await act(async () => root.render(createElement(Probe)))
    const listCalls = list.mock.calls.length

    await act(async () => controller?.remove("acc-1"))

    expect(list.mock.calls.length).toBeGreaterThan(listCalls)
    expect(controller?.error).toBe("删除浏览器配置目录失败")
  })

  it("clears the previous error when the next operation starts", async () => {
    let fail = true
    installBridge({
      save: async () => {
        if (fail) throw remoteError("pigclaude:proxies-save", "代理只支持 HTTP/HTTPS")
        return { id: "p2", name: "LA-02", url: "http://127.0.0.1:2", lastTest: null }
      },
    })
    await act(async () => root.render(createElement(Probe)))

    await act(async () => controller?.saveProxy({ name: "LA-02", url: "socks5://127.0.0.1:2" }))
    expect(controller?.error).toBe("代理只支持 HTTP/HTTPS")

    fail = false
    await act(async () => controller?.saveProxy({ name: "LA-02", url: "http://127.0.0.1:2" }))
    expect(controller?.error).toBeNull()
  })

  it("falls back to a generic message for errors without text", async () => {
    installBridge({
      remove: async () => {
        throw new Error("")
      },
    })
    await act(async () => root.render(createElement(Probe)))
    await act(async () => controller?.remove("acc-1"))

    expect(controller?.error).toBe("账号操作失败")
  })

  it("imports from Claude CLI and refreshes the list", async () => {
    const { list, importFromClaudeCli } = installBridge({})
    await act(async () => root.render(createElement(Probe)))
    const listCalls = list.mock.calls.length

    let imported = false
    await act(async () => {
      imported = (await controller?.importFromClaudeCli({ confirmCopy: true })) ?? false
    })

    expect(imported).toBe(true)
    expect(importFromClaudeCli).toHaveBeenCalledWith({ confirmCopy: true })
    expect(list.mock.calls.length).toBeGreaterThan(listCalls)
    expect(controller?.error).toBeNull()
  })

  it("returns false when the bridge exists but has no import command", async () => {
    installBridge({})
    if (window.pigclaude?.claudeAccounts === undefined) throw new Error("bridge missing")
    ;(window.pigclaude.claudeAccounts as unknown as Record<string, unknown>).importFromClaudeCli =
      undefined
    await act(async () => root.render(createElement(Probe)))

    let imported = true
    await act(async () => {
      imported = (await controller?.importFromClaudeCli({ confirmCopy: true })) ?? true
    })

    expect(imported).toBe(false)
    expect(controller?.error).toBe("桌面账号服务不可用")
  })

  it("returns false and shows the fixed message when the import fails", async () => {
    installBridge({
      importFromClaudeCli: async () => {
        throw remoteError(
          "pigclaude:claude-accounts-import-cli",
          "Claude CLI 凭据已过期，请先在 Claude CLI 中刷新",
        )
      },
    })
    await act(async () => root.render(createElement(Probe)))

    let imported = true
    await act(async () => {
      imported = (await controller?.importFromClaudeCli({ confirmCopy: true })) ?? true
    })

    expect(imported).toBe(false)
    expect(controller?.error).toBe("Claude CLI 凭据已过期，请先在 Claude CLI 中刷新")
  })
})
