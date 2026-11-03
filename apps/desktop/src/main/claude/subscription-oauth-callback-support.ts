// 为 OAuth 回调提供监听端口和恒定时间 state 比较。

import { timingSafeEqual } from "node:crypto"
import type { Server } from "node:http"

/** 监听指定本机地址并返回系统实际分配的端口。 */
export function listenCallbackServer(server: Server, host: string, port = 0): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once("error", onError)
    server.listen(port, host, () => {
      server.off("error", onError)
      const address = server.address()
      if (address === null || typeof address === "string") {
        reject(new Error("回调服务器没有绑定端口"))
        return
      }
      resolve(address.port)
    })
  })
}

/** 在字节长度相同时以恒定时间比较授权 state。 */
export function callbackStateMatches(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
