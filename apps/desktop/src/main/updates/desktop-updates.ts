// 启动桌面更新服务，并把更新请求接到统一退出流程。

import { app } from "electron"
import { errorMessage } from "../error-message"
import { createAppUpdates, type AppUpdatesOptions } from "./app-updates"
import type { UpdateService } from "./update-service"

/** 开始更新检查。创建或启动报错时写入日志，桌面其余功能继续运行。 */
export function startDesktopUpdates(onState: AppUpdatesOptions["onState"]): UpdateService | null {
  let service: UpdateService | null = null
  try {
    service = createAppUpdates({ requestQuit: () => app.quit(), onState })
    service.start()
  } catch (error: unknown) {
    console.error(errorMessage(error))
  }
  return service
}
