// 为工作台审批测试连接真实的内存 MCP 服务，并断言无法归属的请求仍逐次审批。
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { expect, vi } from "vitest"
import type { PermissionRequestEvent } from "../session/permission-broker"

type ApprovalSession = {
  cards(): readonly PermissionRequestEvent[]
  respond(decision: "allow" | "deny"): Promise<void>
}

/** 用双向内存端口接入实际注册的工作台工具处理函数。 */
export async function connectBrowserClient(
  server: McpSdkServerConfigWithInstance | undefined,
  onClose: (close: () => Promise<void>) => void,
): Promise<Client> {
  if (!server) throw new Error("缺少进程内浏览器工具服务")
  const client = new Client({ name: "browser-approval-fixture", version: "1" })
  const [remote, local] = InMemoryTransport.createLinkedPair()
  onClose(async () => {
    await client.close()
    await server.instance.close()
  })
  await server.instance.connect(local)
  await client.connect(remote)
  return client
}

/** 核对一次无子代理归属的浏览器请求仍生成唯一审批卡，拒绝后不执行。 */
export async function withoutAttribution(
  client: Client,
  session: ApprovalSession,
  params: Parameters<Client["callTool"]>[0],
): Promise<void> {
  const count = session.cards().length
  const call = client.callTool(params)
  void call.catch(() => undefined)
  await vi.waitFor(() => expect(session.cards()).toHaveLength(count + 1))
  expect(session.cards()[count]?.subagent).toBeNull()
  await session.respond("deny")
  await expect(call).resolves.toMatchObject({ isError: true })
}
