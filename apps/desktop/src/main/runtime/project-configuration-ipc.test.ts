// 从受信窗口读取项目配置并完成双步信任确认，覆盖变更、别名、撤销和个人路径边界。
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { IpcMainInvokeEvent } from "electron"
import { expect, it } from "vitest"
import { registerProjectConfigurationIpc } from "./project-configuration-ipc"
import { ProjectTrustStore } from "./project-trust-store"

it("只在真实项目通过确认后保存信任，并能撤销", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-project-trust-"))
  const work = join(directory, "work")
  const alias = join(directory, "alias")
  const home = join(directory, "home")
  const personal = join(home, ".claude")
  const trustFile = join(directory, "trusted.json")
  const settings = join(work, ".claude", "settings.json")
  const store = new ProjectTrustStore(trustFile, home)
  try {
    await mkdir(join(work, ".claude"), { recursive: true })
    await mkdir(personal, { recursive: true })
    await symlink(work, alias, process.platform === "win32" ? "junction" : "dir")
    await writeFile(settings, JSON.stringify({ env: { TOKEN: "never-expose-alpha" } }))
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    const event = { sender: { id: 1 } } as IpcMainInvokeEvent
    const rejected = { sender: { id: 2 } } as IpcMainInvokeEvent
    registerProjectConfigurationIpc(
      { handle: (channel, listener) => void handlers.set(channel, listener) },
      {
        isTrusted: (incoming) => incoming === event,
        memberActive: () => true,
        paths: async () => [work, alias, home, personal],
        store: () => store,
        userHome: home,
      },
    )
    const invoke = async (action: string, ...args: unknown[]) =>
      handlers.get(`pigclaude:project-configuration-${action}`)?.(event, ...args)
    const first = await invoke("prepare", alias, true)
    expect(first).toMatchObject({ report: { trust: "untrusted", environment: ["TOKEN"] } })
    expect(JSON.stringify(first)).not.toContain("never-expose-alpha")
    expect(await store.isTrusted(work)).toBe(false)
    const id = (first as { id: string }).id
    await expect(
      handlers.get("pigclaude:project-configuration-confirm")?.(rejected, id),
    ).rejects.toThrow("UNTRUSTED_WORKSPACE_REQUEST")
    await writeFile(settings, JSON.stringify({ env: { TOKEN: "never-expose-beta" } }))
    await expect(invoke("confirm", id)).rejects.toThrow("PROJECT_CONFIGURATION_CHANGED")
    await expect(invoke("confirm", id)).rejects.toThrow("PROJECT_TRUST_CONFIRMATION_REQUIRED")
    expect(await store.isTrusted(alias)).toBe(false)

    const retry = (await invoke("prepare", alias, true)) as { id: string }
    expect(await invoke("confirm", retry.id)).toMatchObject({ trust: "trusted" })
    expect(await new ProjectTrustStore(trustFile, home).isTrusted(work)).toBe(true)
    const revoke = (await invoke("prepare", work, false)) as { id: string }
    expect(await invoke("confirm", revoke.id)).toMatchObject({ trust: "untrusted" })
    expect(await store.isTrusted(alias)).toBe(false)

    for (const path of [home, personal]) {
      expect(await invoke("read", path)).toMatchObject({ trust: "blocked", instructions: [] })
      await expect(invoke("prepare", path, true)).rejects.toThrow("PROJECT_TRUST_BLOCKED")
    }
    await expect(invoke("read", directory)).rejects.toThrow("PROJECT_NOT_FOUND")

    await rename(join(work, ".claude"), join(work, "old-config"))
    await writeFile(
      join(personal, "settings.json"),
      JSON.stringify({ env: { PRIVATE_ONLY: "fixture" } }),
    )
    await symlink(
      personal,
      join(work, ".claude"),
      process.platform === "win32" ? "junction" : "dir",
    )
    expect(await invoke("read", work)).toMatchObject({
      environment: [],
      unreadable: [".claude/settings.json"],
    })
    await expect(invoke("prepare", work, true)).rejects.toThrow("PROJECT_TRUST_BLOCKED")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
