// 给随包 Claude Code 测试提供纯本机上游。记录合成请求体，以最小 Anthropic 消息流完成测试回合。

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

/** 只接收回环请求的假网关及它收到的消息请求。 */
export type ClaudeLocalGateway = {
  readonly url: string
  readonly messages: Array<{
    body: string
    hasSessionHeader: boolean
    hasPlaceholderCredential: boolean
    hasExpectedOAuthCredential?: boolean
  }>
  close(): Promise<void>
}

/** 开启合成消息端点，不转发流量。关闭时停止监听并回收连接。 */
export async function startClaudeLocalGateway(
  expectedOAuthToken?: string,
): Promise<ClaudeLocalGateway> {
  const messages: ClaudeLocalGateway["messages"] = []
  const server = createServer((request, response) => {
    void reply(request, response, messages, expectedOAuthToken).catch(() => response.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("假网关未就绪")
  return {
    url: `http://127.0.0.1:${address.port}`,
    messages,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}

async function reply(
  request: IncomingMessage,
  response: ServerResponse,
  messages: ClaudeLocalGateway["messages"],
  expectedOAuthToken: string | undefined,
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname
  if (path !== "/v1/messages") {
    request.resume()
    response.writeHead(path === "/v1/messages/count_tokens" ? 200 : 404, {
      "content-type": "application/json",
    })
    response.end(path === "/v1/messages/count_tokens" ? '{"input_tokens":100}' : "{}")
    return
  }
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    if (Buffer.isBuffer(chunk)) chunks.push(chunk)
  }
  const body = Buffer.concat(chunks).toString("utf8")
  messages.push({
    body,
    hasSessionHeader: typeof request.headers["x-pigclaude-session"] === "string",
    hasPlaceholderCredential:
      request.headers.authorization === "Bearer pigclaude-local" &&
      request.headers["x-api-key"] === undefined,
    ...(expectedOAuthToken === undefined
      ? {}
      : {
          hasExpectedOAuthCredential:
            request.headers.authorization === `Bearer ${expectedOAuthToken}` &&
            request.headers["x-api-key"] === undefined,
        }),
  })
  const input: unknown = JSON.parse(body)
  const model =
    input && typeof input === "object" && "model" in input && typeof input.model === "string"
      ? input.model
      : "claude-sonnet-5-5"
  const message = {
    id: `msg_local_${messages.length}`,
    type: "message",
    role: "assistant",
    model,
    usage: { input_tokens: 100, output_tokens: 5 },
  }
  if (!input || typeof input !== "object" || !("stream" in input) || input.stream !== true) {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify({
        ...message,
        content: [{ type: "text", text: "synthetic reply" }],
        stop_reason: "end_turn",
        stop_sequence: null,
      }),
    )
    return
  }
  response.writeHead(200, { "content-type": "text/event-stream" })
  const send = (type: string, fields = {}): void => {
    response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`)
  }
  send("message_start", {
    message: { ...message, content: [], stop_reason: null, stop_sequence: null },
  })
  send("content_block_start", { index: 0, content_block: { type: "text", text: "" } })
  send("content_block_delta", { index: 0, delta: { type: "text_delta", text: "synthetic reply" } })
  send("content_block_stop", { index: 0 })
  send("message_delta", {
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 5 },
  })
  send("message_stop")
  response.end()
}
