// 在独立进程中模拟 SOCKS5 握手后断开，检查出口核对不会遗留阻止退出的资源。

import { createServer } from "node:net"
import { checkEgress } from "./egress-check.ts"

let upstreamConnections = 0
let targetConnections = 0
const bridge = createServer((socket) => {
  let phase = 0
  let data = Buffer.alloc(0)
  socket.on("error", () => undefined)
  socket.on("data", (chunk) => {
    data = Buffer.concat([data, chunk])
    if (phase === 0 && data.length >= 2 && data.length >= 2 + data[1]) {
      data = data.subarray(2 + data[1])
      phase = 1
      socket.write(Buffer.from([5, 0]))
    }
    if (phase === 1 && data.length >= 4) {
      phase = 2
      socket.destroy()
    }
  })
})
const upstream = createServer((socket) => {
  upstreamConnections += 1
  socket.destroy()
})
const target = createServer((socket) => {
  targetConnections += 1
  socket.destroy()
})
try {
  const bridgePort = await listen(bridge)
  const upstreamPort = await listen(upstream)
  const targetPort = await listen(target)
  const result = await checkEgress({
    bridgeUrl: `socks5://127.0.0.1:${bridgePort}`,
    upstreamProxyUrl: `http://127.0.0.1:${upstreamPort}`,
    checkUrl: `http://127.0.0.1:${targetPort}/trace`,
    // 必须长于用例等待退出的 3 秒：核对残留的时限计时器这时才会表现为进程不退出。
    timeoutMs: 10_000,
  })
  const { ok, reason } = result
  console.log(JSON.stringify({ ok, reason, upstreamConnections, targetConnections }))
  if (ok || upstreamConnections !== 0 || targetConnections !== 0) process.exitCode = 1
} finally {
  await Promise.all([close(bridge), close(upstream), close(target)])
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("合成服务未监听")
  return address.port
}

async function close(server) {
  if (!server.listening) return
  await new Promise((resolve) => server.close(resolve))
}
