// 在退出应用时按依赖顺序释放桌面资源。

/** 桌面退出过程中需要释放的资源。 */
export type DesktopShutdownResources = {
  stopBackgroundWork?: () => void
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
  resources.stopBackgroundWork?.()
  const initial = await Promise.allSettled([
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
async function start(operation?: () => Promise<void>): Promise<void> {
  await operation?.()
}
