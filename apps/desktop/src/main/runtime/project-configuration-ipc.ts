// 受信窗口通过已登记的项目读取脱敏配置，并使用与配置快照绑定的一次性确认记录信任。
import { randomUUID } from "node:crypto"
import { stat } from "node:fs/promises"
import { isAbsolute } from "node:path"
import type { IpcMain, IpcMainInvokeEvent } from "electron"
import type { ProjectTrustConfirmation } from "../../project-configuration-contract"
import { scanProjectConfiguration } from "../session/project-configuration-scan"
import type { ProjectTrustStore } from "./project-trust-store"

type Ports = {
  isTrusted: (event: IpcMainInvokeEvent) => boolean
  memberActive: () => boolean
  paths: () => Promise<string[]>
  store: () => ProjectTrustStore
  userHome?: string
}
type Pending = {
  id: string
  path: string
  workspace: string
  fingerprint: string
  trusted: boolean
  expires: number
}

const confirmationWindowMs = 2 * 60_000
const expectedErrors =
  /^PROJECT_(NOT_FOUND|TRUST_BLOCKED|TRUST_CONFIRMATION_REQUIRED|CONFIGURATION_CHANGED)$/

/** 只为受信窗口和登记过的真实工作区提供报告，以及可废止的一次性确认。 */
export function registerProjectConfigurationIpc(ipc: Pick<IpcMain, "handle">, ports: Ports): void {
  const pending = new Map<number, Pending>()
  const handle = (
    channel: string,
    read: (windowId: number, args: unknown[]) => Promise<unknown>,
  ): void => {
    ipc.handle(`pigclaude:project-configuration-${channel}`, async (event, ...args: unknown[]) => {
      if (!ports.isTrusted(event)) throw new Error("UNTRUSTED_WORKSPACE_REQUEST")
      if (!ports.memberActive()) throw new Error("MEMBERSHIP_REQUIRED")
      try {
        return await read(event.sender.id, args)
      } catch (error) {
        const message = error instanceof Error ? error.message : ""
        if (expectedErrors.test(message) || message === "MEMBERSHIP_REQUIRED")
          throw new Error(message)
        throw new Error("PROJECT_CONFIGURATION_UNAVAILABLE")
      }
    })
  }
  const inspect = async (path: unknown) => {
    if (
      typeof path !== "string" ||
      path.length > 4096 ||
      !isAbsolute(path) ||
      !(await ports.paths()).includes(path) ||
      !(await stat(path).catch(() => null))?.isDirectory()
    )
      throw new Error("PROJECT_NOT_FOUND")
    return scanProjectConfiguration(
      path,
      (workspace) => ports.store().isTrusted(workspace),
      ports.userHome,
    )
  }
  handle("read", async (_windowId, [path]) => (await inspect(path)).report)
  handle("prepare", async (windowId, [path, trusted]): Promise<ProjectTrustConfirmation> => {
    if (typeof trusted !== "boolean" || typeof path !== "string")
      throw new Error("PROJECT_TRUST_CONFIRMATION_REQUIRED")
    const { report, fingerprint } = await inspect(path)
    if (report.trust === "blocked" || (trusted && report.unreadable.length > 0))
      throw new Error("PROJECT_TRUST_BLOCKED")
    const id = randomUUID()
    pending.set(windowId, {
      id,
      path,
      workspace: report.workspace,
      fingerprint,
      trusted,
      expires: Date.now() + confirmationWindowMs,
    })
    return { id, report, trusted }
  })
  handle("confirm", async (windowId, [id]) => {
    const candidate = pending.get(windowId)
    if (!candidate || candidate.id !== id) throw new Error("PROJECT_TRUST_CONFIRMATION_REQUIRED")
    pending.delete(windowId)
    if (candidate.expires < Date.now()) throw new Error("PROJECT_TRUST_CONFIRMATION_REQUIRED")
    const { report, fingerprint } = await inspect(candidate.path)
    if (
      report.workspace !== candidate.workspace ||
      report.trust === "blocked" ||
      (candidate.trusted && fingerprint !== candidate.fingerprint)
    )
      throw new Error("PROJECT_CONFIGURATION_CHANGED")
    if (!ports.memberActive()) throw new Error("MEMBERSHIP_REQUIRED")
    await ports.store().setTrusted(report.workspace, candidate.trusted)
    return { ...report, trust: candidate.trusted ? "trusted" : "untrusted" }
  })
}
