// 负责在回环地址接收浏览器授权回调，并把结果交给主进程服务。
import { createServer } from "node:http"

/** 启动只绑定 127.0.0.1 的回调服务并返回授权 redirect URI。 */
export async function createCallbackServer(
  onCallback: (url: string) => Promise<void>,
): Promise<{ redirectUri: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1")
    if (requestUrl.pathname !== "/oauth/callback") {
      response.statusCode = 404
      response.end("Not found")
      return
    }
    const address = server.address()
    const port = address && typeof address !== "string" ? address.port : 0
    const callbackUrl = `http://127.0.0.1:${port}${requestUrl.pathname}${requestUrl.search}`
    void onCallback(callbackUrl).then(
      () => {
        response.setHeader("content-type", "text/html; charset=utf-8")
        response.end("<h1>授权完成</h1><p>可以返回 pigclaude。</p>")
      },
      () => {
        response.statusCode = 500
        response.end("授权失败")
      },
    )
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    await closeServer(server)
    throw new Error("无法创建授权回调地址")
  }
  return {
    redirectUri: `http://127.0.0.1:${address.port}/oauth/callback`,
    close: () => closeServer(server),
  }
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
