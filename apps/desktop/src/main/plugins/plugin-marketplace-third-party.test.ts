// 验证第三方市场的默认值、持久同意和对旧请求的撤销。
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { PluginMarketplaceThirdParty } from "./plugin-marketplace-third-party"

it("同意前默认关闭，显式选择持久化且重新打开不会复活旧请求", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-market-preference-"))
  const path = join(directory, "third-party.json")
  const changed = vi.fn()
  let active = true
  const preference = new PluginMarketplaceThirdParty(path, () => active, changed)
  try {
    await expect(preference.enabled()).resolves.toBe(false)
    await expect(preference.authorize()).rejects.toThrow("PLUGIN_MARKETPLACE_THIRD_PARTY_DISABLED")
    await preference.setEnabled(true)
    const previous = await preference.authorize()
    previous()
    await expect(
      new PluginMarketplaceThirdParty(path, () => true, changed).enabled(),
    ).resolves.toBe(true)
    await preference.setEnabled(false)
    expect(previous).toThrow("PLUGIN_MARKETPLACE_THIRD_PARTY_DISABLED")
    await preference.setEnabled(true)
    expect(previous).toThrow("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
    active = false
    await expect(preference.setEnabled(false)).rejects.toThrow("MEMBERSHIP_REQUIRED")
    await expect(preference.enabled()).resolves.toBe(true)
    expect(changed).toHaveBeenCalledTimes(3)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("无效的本机值不能打开第三方市场", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-market-preference-"))
  const path = join(directory, "third-party.json")
  try {
    await writeFile(path, '{"enabled":"true"}')
    await expect(
      new PluginMarketplaceThirdParty(
        path,
        () => true,
        () => {},
      ).enabled(),
    ).resolves.toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
