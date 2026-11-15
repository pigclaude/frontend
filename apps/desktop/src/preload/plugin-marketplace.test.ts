// 核对预加载仅使用固定市场频道，并且刷新回调不接收 Electron 对象。

import { expect, it, vi } from "vitest"
import {
  pluginMarketplaceChangedChannel,
  pluginMarketplaceChannelPrefix,
} from "../plugin-marketplace-contract"
import { pluginMarketplaceBridge } from "./plugin-marketplace"

const wire = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  on: vi.fn<(channel: string, listener: (...args: unknown[]) => void) => void>(),
  removeListener: vi.fn(),
}))

vi.mock("electron", () => ({ ipcRenderer: wire }))

it("按契约转发操作并清理同一个刷新订阅", async () => {
  const market = pluginMarketplaceBridge()
  const source = { kind: "github", repo: "sample/catalog", commit: "a".repeat(40) } as const
  await market.list()
  await market.selectDirectory()
  await market.add(source)
  await market.refresh("source")
  await market.refresh("source", "b".repeat(40))
  await market.setEnabled("source", false)
  await market.remove("source")
  await market.prepareInstall("source", "entry")
  await market.prepareUpdate("source", "entry")
  const operations = [
    ["list"],
    ["select-directory"],
    ["add", source],
    ["refresh", "source"],
    ["refresh", "source", "b".repeat(40)],
    ["set-enabled", "source", false],
    ["remove", "source"],
    ["prepare-install", "source", "entry"],
    ["prepare-update", "source", "entry"],
  ] as const
  expect(wire.invoke.mock.calls).toEqual(
    operations.map(([name, ...args]) => [pluginMarketplaceChannelPrefix + name, ...args]),
  )

  const listener = vi.fn()
  const unsubscribe = market.subscribe(listener)
  const [channel, receive] = wire.on.mock.calls[0] ?? []
  expect(channel).toBe(pluginMarketplaceChangedChannel)
  receive?.({ sender: "private" }, { reason: "private" })
  expect(listener).toHaveBeenCalledExactlyOnceWith()
  expect(unsubscribe()).toBeUndefined()
  expect(wire.removeListener).toHaveBeenCalledExactlyOnceWith(channel, receive)
})
