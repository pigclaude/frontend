// 负责在请求取消时关闭正在建立的 Xray SOCKS5 连接。

import type { ClientRequest } from "node:http"
import { connect, isIP, type Socket } from "node:net"
import { checkServerIdentity, connect as connectTls, type ConnectionOptions } from "node:tls"
import { SocksClient } from "socks"
import { SocksProxyAgent } from "socks-proxy-agent"

type ConnectOptions = Parameters<SocksProxyAgent["connect"]>[1]

/** SOCKS 客户端保证请求中止时同步关闭尚在握手的本机 socket。 */
export class XraySocksAgent extends SocksProxyAgent {
  readonly #port: number
  readonly #signal: AbortSignal

  /** 为一个请求创建绑定 Xray 端口和取消信号的代理客户端。 */
  constructor(port: number, signal: AbortSignal) {
    super(`socks5h://127.0.0.1:${port}`)
    this.#port = port
    this.#signal = signal
  }

  /** 通过 Xray 建立目标连接；取消时不继续 SOCKS 握手。 */
  override async connect(_request: ClientRequest, options: ConnectOptions): Promise<Socket> {
    this.#signal.throwIfAborted()
    const host = options.host?.replace(/^\[|\]$/g, "")
    const port = Number(options.port)
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("目标地址无效")
    }
    const socket = connect({ host: "127.0.0.1", port: this.#port, signal: this.#signal })
    socket.on("error", () => undefined)
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve)
        socket.once("error", reject)
      })
      this.#signal.throwIfAborted()
      await SocksClient.createConnection({
        command: "connect",
        proxy: { host: "127.0.0.1", port: this.#port, type: 5 },
        destination: { host, port },
        existing_socket: socket,
        timeout: 15_000,
      })
      this.#signal.throwIfAborted()
      if (!options.secureEndpoint) return socket
      const tlsOptions: ConnectionOptions = { ...options, socket }
      delete tlsOptions.host
      delete tlsOptions.port
      delete tlsOptions.path
      if (tlsOptions.servername === undefined && isIP(host) === 0) tlsOptions.servername = host
      const checkIdentity = options.checkServerIdentity ?? checkServerIdentity
      tlsOptions.checkServerIdentity = (_name, certificate) => checkIdentity(host, certificate)
      const tlsSocket = connectTls(tlsOptions)
      tlsSocket.once("error", () => socket.destroy())
      return tlsSocket
    } catch (error: unknown) {
      socket.destroy()
      throw error
    }
  }
}
