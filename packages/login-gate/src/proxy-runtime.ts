// 定义外部代理核心提供的本机入口及其生命周期，不实现代理协议或数据转发。

/** 外部代理核心的运行实例；url 指向本机入口，close 释放本次实例持有的资源。 */
export type ProxyRuntime = {
  url: string
  close: () => Promise<void>
}

/** 启动指定上游的外部代理核心；失败时拒绝返回，不回退到系统网络。 */
export type StartProxyRuntime = (input: { upstreamProxyUrl: string }) => Promise<ProxyRuntime>
