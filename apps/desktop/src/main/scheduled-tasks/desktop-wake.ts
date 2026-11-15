// 监听桌面休眠和唤醒，补跑沿用会员门禁的联网恢复时机。

import { net, powerMonitor } from "electron"
import type { MembershipGate } from "../membership/membership-gate"
import { reportScheduledTasksError } from "./desktop-service"
import type { ScheduledTaskService } from "./service"

/** 休眠和等待网络期间暂停巡检，联网后才重算本地排期。 */
export function trackDesktopWake(
  membership: Pick<MembershipGate, "resumeAfterWake">,
  tasks: Pick<ScheduledTaskService, "suspend" | "wake"> | null,
): () => void {
  const suspend = () => tasks?.suspend()
  const resume = () => {
    suspend()
    membership.resumeAfterWake(
      () => net.isOnline(),
      () => void tasks?.wake().catch(reportScheduledTasksError),
    )
  }
  powerMonitor.on("suspend", suspend)
  powerMonitor.on("resume", resume)
  return () => {
    powerMonitor.removeListener("suspend", suspend)
    powerMonitor.removeListener("resume", resume)
  }
}
