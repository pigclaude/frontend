// 负责验证新会话默认设置的 IPC：只接受受信主窗口，修改先校验再写，失败只返回登记过的错误码。

import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { IpcMain, IpcMainInvokeEvent } from "electron"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { builtinSessionDefaults } from "../../session-defaults-contract"
import { SessionDefaultsStore } from "./session-defaults"
import { registerSessionDefaultsIpc } from "./session-defaults-ipc"

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

let directory: string
let filePath: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pigclaude-session-defaults-ipc-"))
  filePath = join(directory, "session-defaults.json")
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function setup(options: {
  trusted?: boolean
  store?: Pick<SessionDefaultsStore, "get" | "update">
}) {
  const handlers = new Map<string, Handler>()
  registerSessionDefaultsIpc(
    {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    } as unknown as Pick<IpcMain, "handle">,
    {
      isTrusted: () => options.trusted ?? true,
      store: () => options.store ?? new SessionDefaultsStore({ filePath }),
    },
  )
  return (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(`pigclaude:session-defaults-${channel}`)
    if (!handler) throw new Error(`missing ${channel}`)
    return handler({} as IpcMainInvokeEvent, ...args)
  }
}

describe("session defaults ipc", () => {
  it("reads and saves defaults for the trusted window", async () => {
    const invoke = setup({})

    await expect(invoke("get")).resolves.toEqual(builtinSessionDefaults)
    await expect(invoke("set", { permissionMode: "acceptEdits" })).resolves.toEqual({
      ...builtinSessionDefaults,
      permissionMode: "acceptEdits",
    })
    await expect(invoke("get")).resolves.toEqual({
      ...builtinSessionDefaults,
      permissionMode: "acceptEdits",
    })
  })

  it("rejects untrusted senders before touching the file", async () => {
    const invoke = setup({ trusted: false })

    await expect(invoke("get")).rejects.toThrow("UNTRUSTED_SESSION_DEFAULTS_REQUEST")
    await expect(invoke("set", { model: "claude-opus" })).rejects.toThrow(
      "UNTRUSTED_SESSION_DEFAULTS_REQUEST",
    )
    await expect(stat(filePath)).rejects.toThrow()
  })

  it("rejects invalid patches without writing", async () => {
    const invoke = setup({})

    for (const patch of [undefined, { permissionMode: "plan" }, { model: "a\u0000b" }]) {
      await expect(invoke("set", patch)).rejects.toThrow("SESSION_DEFAULTS_INVALID")
    }
    await expect(stat(filePath)).rejects.toThrow()
  })

  it("hides storage failures behind a registered error code", async () => {
    const invoke = setup({
      store: {
        get: async () => {
          throw new Error(`EACCES: permission denied, open '${filePath}'`)
        },
        update: async () => {
          throw new Error(`EACCES: permission denied, open '${filePath}'`)
        },
      },
    })

    await expect(invoke("get")).rejects.toThrow(/^SESSION_DEFAULTS_FAILED$/)
    await expect(invoke("set", { model: "claude-opus" })).rejects.toThrow(
      /^SESSION_DEFAULTS_FAILED$/,
    )
  })
})
