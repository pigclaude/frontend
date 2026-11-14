// 负责验证最近工作区入口和项目显示名的配合：被挤出列表的项目再次添加时用回文件夹名。
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { IpcMainInvokeEvent } from "electron"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const handlers = vi.hoisted(() => new Map<string, Handler>())

vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
  shell: { openPath: async () => "" },
}))

const { registerWorkspaceIpc } = await import("./workspace-ipc")

let directory: string

beforeEach(async () => {
  handlers.clear()
  directory = await mkdtemp(join(tmpdir(), "pigclaude-workspace-ipc-"))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(`pigclaude:${channel}`)
  if (!handler) throw new Error(`missing ${channel}`)
  return handler({} as IpcMainInvokeEvent, ...args)
}

describe("registerWorkspaceIpc", () => {
  it("forgets an evicted project's display name when the folder is added again", async () => {
    registerWorkspaceIpc({
      filePath: () => join(directory, "workspaces.json"),
      isTrusted: () => true,
      workbench: { register: () => undefined } as unknown as Parameters<
        typeof registerWorkspaceIpc
      >[0]["workbench"],
      membership: () =>
        ({ state: "active" }) as ReturnType<
          Parameters<typeof registerWorkspaceIpc>[0]["membership"]
        >,
      hasActiveTurn: () => false,
    })
    const project = join(directory, "api")
    await mkdir(project)
    await invoke("workspaces-add", project)
    await invoke("projects-rename", project, "后端")
    for (let index = 0; index < 10; index += 1) {
      const other = join(directory, `other-${index}`)
      await mkdir(other)
      await invoke("workspaces-add", other)
    }

    await invoke("workspaces-add", project)

    await expect(invoke("projects-names")).resolves.toEqual({})
  })
})
