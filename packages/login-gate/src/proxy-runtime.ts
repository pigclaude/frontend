// 定义外部代理核心提供的本机入口及其生命周期，不实现代理协议或数据转发。

/** 外部代理核心的运行实例；url 指向本机入口，close 释放本次实例持有的资源。 */
export type ProxyRuntime = {
  url: string
  close: () => Promise<void>
  /** 若运行时支持状态核对，退出或开始关闭后必须拒绝后续使用。 */
  assertRunning?: () => void
  /** Xray 正在按原端口恢复时等待恢复结果。 */
  ready?: () => Promise<void>
  /** Xray 退出且原端口恢复失败时通知当前使用者。 */
  failure?: Promise<Error>
}

/** 启动指定上游的外部代理核心；失败时拒绝返回，不回退到系统网络。 */
export type StartProxyRuntime = (input: { upstreamProxyUrl: string }) => Promise<ProxyRuntime>
