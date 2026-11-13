// 按依赖顺序关闭桌面资源，确保浏览器确认退出后再关闭 Xray。

/** 桌面退出过程中需要释放的资源。 */
export type DesktopShutdownResources = {
  accounts?: () => Promise<void>
  sessions?: () => Promise<void>
  workbench?: () => Promise<void>
  composition?: () => Promise<void>
  xray: () => Promise<void>
  callback?: () => Promise<void>
}

/** 账号与浏览器清理成功后才关闭 Xray；失败时保留代理并报告错误。 */
export async function shutdownDesktopResources(resources: DesktopShutdownResources): Promise<void> {
  const initial = await Promise.allSettled([
    Promise.resolve().then(() => resources.accounts?.()),
    Promise.resolve().then(() => resources.sessions?.()),
    Promise.resolve().then(() => resources.workbench?.()),
  ])
  const failure = initial.find((result) => result.status === "rejected")
  if (failure?.status === "rejected") throw failure.reason
  await resources.composition?.()
  await resources.xray()
  await resources.callback?.()
}
