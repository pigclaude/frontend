// 负责会员受限 IPC，撤销只能先准备可信目标再提交一次性确认，拒绝 renderer 自报身份。
import { ipcMain, type IpcMainInvokeEvent } from "electron"
import type { DesktopComposition } from "../composition"
/** 会员 IPC 只取得当前组合服务与主窗口来源证明。 */
export type MembershipIpcOptions = {
  getComposition: () => DesktopComposition | null
  isTrusted: (event: IpcMainInvokeEvent) => boolean
  onSignOut: () => void
}
/** 注册本人查询、受控网站入口与撤销确认，保留既有本机退出边界。 */
export function registerMembershipIpc(options: MembershipIpcOptions): void {
  const requireComposition = () => {
    const composition = options.getComposition()
    if (!composition) throw new Error("桌面授权服务尚未准备好")
    return composition
  }
  const context = (event: IpcMainInvokeEvent, value: unknown): string => {
    if (!options.isTrusted(event) || typeof value !== "string" || !value || value.length > 100)
      throw new Error("UNTRUSTED_MEMBERSHIP_REQUEST")
    return value
  }
  ipcMain.handle(
    "pigclaude:membership-inspect",
    async () => options.getComposition()?.membershipGate.inspect() ?? null,
  )
  ipcMain.handle(
    "pigclaude:membership-subscribe",
    async () => options.getComposition()?.membershipGate.view() ?? null,
  )
  ipcMain.handle("pigclaude:membership-open-website", async (event, value: unknown) =>
    requireComposition().openMembershipWebsite(context(event, value)),
  )
  ipcMain.handle("pigclaude:membership-prepare-withdrawal", async (event, value: unknown) =>
    requireComposition().prepareWithdrawal(context(event, value)),
  )
  ipcMain.handle("pigclaude:membership-withdraw", async (event, value: unknown) =>
    requireComposition().withdraw(context(event, value)),
  )
  ipcMain.handle("pigclaude:membership-sign-out", async () => {
    options.onSignOut()
    return requireComposition().signOut()
  })
}
