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
}): { list: ReturnType<typeof vi.fn> } {
  const list = vi.fn(async (): Promise<ClaudeAccountView[]> => [])
  const proxy: ProxyView = { id: "p1", name: "LA-01", url: "http://127.0.0.1:1", lastTest: null }
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
  return { list }
}

describe("useClaudeAccounts errors", () => {
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
})
