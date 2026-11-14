// 列出 daemon 会注入账号凭据的上游端点：消息接口和模型目录读取用的 bootstrap。
// 方法和路径都精确匹配；其他请求原样带着调用方的头转发，不注入凭据。

const claudeBootstrapPath = "/api/claude_cli/bootstrap"

/** 一个上游请求在 daemon 里的处理方式。 */
export type EndpointKind = "message" | "bootstrap" | "passthrough"

/** 保证只有 POST /v1/messages 算消息接口，只有 GET /api/claude_cli/bootstrap 算模型目录读取。 */
export function endpointKind(method: string, pathname: string): EndpointKind {
  if (method === "POST" && pathname === "/v1/messages") return "message"
  if (method === "GET" && pathname === claudeBootstrapPath) return "bootstrap"
  return "passthrough"
}
