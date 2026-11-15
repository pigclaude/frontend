// 负责主窗口启动后的设备版本上报，复用当前授权会话。

import type { DesktopComposition } from "../composition"
import { errorMessage } from "../error-message"
import { readDeviceInfo } from "./device-info"

/** 已授权时上报一次设备版本，失败只记日志。 */
export async function reportDeviceInfoOnStartup(
  composition: DesktopComposition | null,
): Promise<void> {
  if (composition === null) return
  try {
    const snapshot = await composition.tokenManager.snapshot()
    if (!snapshot) return
    const info = await readDeviceInfo()
    await composition.tokenManager.run((current) =>
      composition.api.reportDeviceInfo(info, current.record.accessToken),
    )
  } catch (error: unknown) {
    console.error(errorMessage(error))
  }
}
