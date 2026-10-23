// 负责本轮未列入allowlist的随机loopback计数探针，不读取或记录请求headers/body。
import { createServer } from "node:http"
import { expect, type BrowserContext } from "@playwright/test"
/** 验证实际调用方创建的上下文在任何认证操作前已阻止未登记origin。 */
export async function startBoundaryCanary() {
  let requests = 0
  const checked: string[] = []
  const server = createServer((_request, response) => {
    requests += 1
    response.writeHead(200, { "content-type": "text/plain" }).end("canary")
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("CANARY_BIND_FAILED")
  const origin = `http://127.0.0.1:${address.port}`
  return {
    /** 使用调用方已创建的context检查网络阻断，不以另建正确helper代替调用方。 */
    async verify(context: BrowserContext, path: string) {
      const page = await context.newPage()
      let blocked = false
      try {
        await page.goto(origin).catch(() => {
          blocked = true
        })
        expect(requests, `${path}: unlisted canary must receive zero requests`).toBe(0)
        expect(blocked, `${path}: browser request must be rejected`).toBe(true)
        checked.push(path)
      } finally {
        await page.close()
      }
    },
    /** 返回无秘密的计数与实际调用路径。 */
    receipt() {
      return { origin, requests, checked, readsHeadersOrBody: false }
    },
    /** 仅关闭本例计数server。 */
    async close() {
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}
