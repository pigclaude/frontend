// 通过真实 MCP 请求验证截图的尺寸审批、JPEG 结果与读取像素的时机。
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { WebContents } from "electron"
import { expect, it, vi } from "vitest"
import type { BrowserApprovalPort } from "../session/browser-tool-approval"
import { boundedBrowserScreenshotSize } from "./browser-screenshot"
import type { WorkbenchBrowsers } from "./browser-surface"
import { browserSessionTools } from "./browser-tools"

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
}))

it("在实际 MCP 上拒绝或未批准时不读像素，批准后返回 JPEG 图文块", async () => {
  let answer: (allow: boolean) => void = () => undefined
  const request = vi.fn<BrowserApprovalPort["request"]>(
    () =>
      new Promise<boolean>((resolve) => {
        answer = resolve
      }),
  )
  const image = { type: "image", mimeType: "image/jpeg", data: "/9j/2Q==" } as const
  const capture = vi.fn(async () => image)
  const context = {
    kind: "screenshot",
    url: "http://127.0.0.1:5173/",
    width: 640,
    height: 400,
  } as const
  const browsers = {
    prepareAgentScreenshot: vi.fn(async () => ({ context, capture })),
  } as unknown as WorkbenchBrowsers
  const contents = { isDestroyed: () => false } as WebContents
  const config = browserSessionTools(
    contents,
    browsers,
    () => true,
    {
      request,
      denial: () => null,
      rememberCaller: () => undefined,
    },
    { id: "agent-screenshot-fixture", sessionId: "screenshot-fixture-session" },
  ).pigclaude_workbench
  if (!config) throw new Error("没有注册本机 MCP 工作台")
  const client = new Client({ name: "screenshot-fixture", version: "1" })
  const [remote, local] = InMemoryTransport.createLinkedPair()
  await config.instance.connect(local)
  await client.connect(remote)
  try {
    const denied = client.callTool({ name: "browser_screenshot", arguments: {} })
    await vi.waitFor(() => expect(request.mock.calls.map(([value]) => value)).toEqual([context]))
    expect(capture).not.toHaveBeenCalled()
    answer(false)
    await expect(denied).resolves.toMatchObject({ isError: true })
    expect(capture).not.toHaveBeenCalled()

    const accepted = client.callTool({ name: "browser_screenshot", arguments: {} })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    answer(true)
    await expect(accepted).resolves.toEqual({
      content: [{ type: "text", text: "Browser screenshot (640 × 400)." }, image],
    })
    expect(capture).toHaveBeenCalledOnce()
  } finally {
    await client.close()
    await config.instance.close()
  }
})

it("截图横竖最长边和总面积都在预算内，小视口不放大", () => {
  expect(boundedBrowserScreenshotSize({ width: 640, height: 480 })).toEqual({
    width: 640,
    height: 480,
  })
  expect(boundedBrowserScreenshotSize({ width: 1440, height: 2560 })).toEqual({
    width: 720,
    height: 1280,
  })
  const square = boundedBrowserScreenshotSize({ width: 2000, height: 2000 })
  expect(square.width).toBe(square.height)
  expect(square.width * square.height).toBeLessThanOrEqual(1_200_000)
})
