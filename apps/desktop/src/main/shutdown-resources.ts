// 在退出应用时按依赖顺序释放桌面资源。

/** 桌面退出过程中需要释放的资源。 */
export type DesktopShutdownResources = {
  /** 同步停下调度，并可返回尚需等待落盘的后台运行记录。 */
  stopBackgroundWork?: () => void | Promise<void>
  accounts?: () => Promise<void>
  sessions?: () => Promise<void>
  workbench?: () => Promise<void>
  composition?: () => Promise<void>
  xray: () => Promise<void>
  callback?: () => Promise<void>
  releaseAwake?: () => void
  destroyTray?: () => void
}

/** 先停后台调度并等待会话、账号和终端关闭，再释放它们依赖的服务。 */
export async function shutdownDesktopResources(resources: DesktopShutdownResources): Promise<void> {
  const initial = await Promise.allSettled([
    start(resources.stopBackgroundWork),
    start(resources.sessions),
    start(resources.accounts),
    start(resources.workbench),
  ])
  const failure = initial.find((result) => result.status === "rejected")
  if (failure?.status === "rejected") throw failure.reason
  await resources.composition?.()
  await resources.xray()
  await resources.callback?.()
  resources.releaseAwake?.()
  resources.destroyTray?.()
}

// Windows 的会话结束事件返回后系统可以终止进程。首批关停操作要在事件回调内开始。
async function start(operation?: () => void | Promise<void>): Promise<void> {
  await operation?.()
}
