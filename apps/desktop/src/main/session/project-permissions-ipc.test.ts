// 验证项目授权 IPC 只接受可信窗口，撤销只接受本机生成的规则 id。

import type { IpcMainInvokeEvent } from "electron"
import { expect, it, vi } from "vitest"
import { projectPermissionCleanupFailed } from "../../project-permissions-contract"
import { registerProjectPermissionsIpc } from "./project-permissions-ipc"

it("只让可信窗口查看并按 id 撤销规则", async () => {
  const callbacks = new Map<string, (event: IpcMainInvokeEvent, value?: unknown) => unknown>()
  const event = {} as IpcMainInvokeEvent
  const id = "01234567-89ab-cdef-0123-456789abcdef"
  const entries = [{ id, projectPath: "/project", kind: "allow" as const, value: "Bash(ls)" }]
  const store = {
    list: vi.fn().mockResolvedValue(entries),
    revoke: vi.fn().mockResolvedValue([]),
  }
  registerProjectPermissionsIpc(
    {
      handle: (channel, handler) => {
        callbacks.set(channel, handler)
      },
    },
    {
      getStore: () => store,
      isTrusted: (sender) => sender === event,
    },
  )
  const list = callbacks.get("pigclaude:project-permissions-list")
  const revoke = callbacks.get("pigclaude:project-permissions-revoke")
  if (!list || !revoke) throw new Error("缺少项目授权 IPC")
  await expect(list({} as IpcMainInvokeEvent)).rejects.toThrow("UNTRUSTED_SESSION_REQUEST")
  await expect(revoke(event, { id, value: "Bash(*)" })).rejects.toThrow("INVALID_SESSION_INPUT")
  expect(store.list).not.toHaveBeenCalled()
  expect(store.revoke).not.toHaveBeenCalled()
  await expect(list(event)).resolves.toEqual(entries)
  await expect(revoke(event, id)).resolves.toEqual([])
  expect(store.revoke).toHaveBeenCalledExactlyOnceWith(id)
  store.revoke.mockRejectedValueOnce(new Error(projectPermissionCleanupFailed))
  await expect(revoke(event, id)).rejects.toThrow(projectPermissionCleanupFailed)
})
