// 为安装态验收提供只绑定回环的认证 SOCKS5 中转，并统计拒绝后的连接。
import assert from "node:assert/strict"
import { once } from "node:events"
import { connect, createServer } from "node:net"

const allowedHosts = new Set([
  "ipv4.icanhazip.com",
  "api-ipv4.ip.sb",
  "claude.ai",
  "www.claude.ai",
  "1.1.1.1",
])

async function read(socket, length) {
  while (!socket.destroyed && !socket.readableEnded) {
    const value = socket.read(length)
    if (Buffer.isBuffer(value)) return value
    await once(socket, "readable", { signal: AbortSignal.timeout(15000) })
  }
  throw new Error("SOCKS5 测试连接提前关闭")
}

/** 启动有限目的地的 SOCKS5 中转，失败模式保留监听以证明调用方实际连接过。 */
export async function startInstalledSocksRelay() {
  const sockets = new Set()
  const destinations = []
  let authenticated = 0
  let denied = 0
  let failing = false
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    socket.on("error", () => socket.destroy())
    if (failing) {
      denied += 1
      socket.destroy()
      return
    }
    void (async () => {
      const greeting = await read(socket, 2)
      const methods = await read(socket, greeting[1])
      assert(greeting[0] === 5 && methods.includes(2), "SOCKS5 必须提供认证")
      socket.write(Buffer.from([5, 2]))
      const auth = await read(socket, 2)
      const user = (await read(socket, auth[1])).toString("utf8")
      const passLength = (await read(socket, 1))[0]
      const password = (await read(socket, passLength)).toString("utf8")
      if (user !== "qa@user" || password !== "pass:word") {
        socket.end(Buffer.from([1, 1]))
        return
      }
      authenticated += 1
      socket.write(Buffer.from([1, 0]))
      const request = await read(socket, 4)
      assert(request[0] === 5 && request[1] === 1, "只支持 CONNECT")
      let host
      if (request[3] === 3) {
        const length = (await read(socket, 1))[0]
        host = (await read(socket, length)).toString("ascii")
      } else if (request[3] === 1) {
        host = [...(await read(socket, 4))].join(".")
      } else {
        socket.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0]))
        return
      }
      const port = (await read(socket, 2)).readUInt16BE()
      if (!allowedHosts.has(host) || port !== 443) {
        socket.end(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]))
        return
      }
      const upstream = connect({ host, port })
      sockets.add(upstream)
      upstream.on("close", () => sockets.delete(upstream))
      upstream.on("error", () => socket.destroy())
      socket.once("close", () => upstream.destroy())
      await once(upstream, "connect", { signal: AbortSignal.timeout(15000) })
      destinations.push({ host, port, domain: request[3] === 3 })
      socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
      socket.pipe(upstream).pipe(socket)
    })().catch(() => socket.destroy())
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  assert(address && typeof address !== "string")
  return {
    url: "socks5://qa%40user:pass%3Aword@127.0.0.1:" + address.port,
    snapshot: () => ({ authenticated, denied, destinations: [...destinations] }),
    fail() {
      failing = true
      for (const socket of sockets) socket.destroy()
    },
    restore() {
      failing = false
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}
