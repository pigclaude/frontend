// 负责临时替换冷启动测试的 platform/argv 并恢复原始描述符，不改其余进程端口。

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
const originalArguments = Object.getOwnPropertyDescriptor(process, "argv")

/** 为当前合成用例设置平台和启动参数，不执行参数中的程序或 URL。 */
export function setColdStartProcess(platform: NodeJS.Platform, argv: readonly string[]): void {
  Object.defineProperty(process, "platform", { configurable: true, value: platform })
  Object.defineProperty(process, "argv", { configurable: true, value: [...argv] })
}

/** 恢复当前测试工作进程原本的属性值和标志，避免影响后续用例。 */
export function restoreColdStartProcess(): void {
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform)
  if (originalArguments) Object.defineProperty(process, "argv", originalArguments)
}
