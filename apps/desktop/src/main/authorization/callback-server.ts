// 负责在回环地址接收浏览器授权回调，并把结果交给主进程服务。
import { createServer } from "node:http"
import { sendCompletionPage } from "./completion-page"
import type { AuthorizationStateEvent } from "./types"

/** 只绑定本机；仅主进程明确完成授权时返回成功页，不把 Promise 完成当作授权成功。 */
export async function createCallbackServer(
  onCallback: (url: string) => Promise<Pick<AuthorizationStateEvent, "status"> | null>,
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
      (result) => {
        const completed = result?.status === "completed"
        sendCompletionPage(response, {
          kind: completed ? "success" : "error",
          title: completed
            ? "授权完成"
            : result?.status === "cancelled"
              ? "授权已取消"
              : "授权未完成",
          message: completed
            ? "PigClaude 已完成授权，请回到应用查看结果。"
            : result?.status === "denied"
              ? "本次授权已取消或未获批准。请回到 PigClaude 查看当前状态。"
              : "本次授权尚未完成。请回到 PigClaude 查看当前状态，或重新发起授权。",
          hint: "这个标签页可以直接关闭",
        })
      },
      () => {
        sendCompletionPage(
          response,
          {
            kind: "error",
            title: "授权未完成",
            message: "授权回调处理失败，请回到 PigClaude 重试。",
            hint: "如果问题持续，请重新发起授权。",
          },
          500,
        )
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
