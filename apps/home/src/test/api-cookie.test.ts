// 负责验证 home client 使用 cookie，并在 401 时触发统一会话恢复回调。
import { describe, expect, it, vi } from "vitest"
import { createClient } from "@pigclaude/api/client"

describe("home HTTP client options", () => {
  it("sends include credentials and invokes unauthorized recovery", async () => {
    const onUnauthorized = vi.fn()
    const requestFetch = vi.fn(
      async () => new Response(JSON.stringify({ message: "expired" }), { status: 401 }),
    )
    const client = createClient({ fetch: requestFetch, credentials: "include", onUnauthorized })
    await expect(client.get("/v1/user/me")).rejects.toMatchObject({ status: 401 })
    expect(requestFetch).toHaveBeenCalledWith(
      "/v1/user/me",
      expect.objectContaining({ credentials: "include" }),
    )
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  it("exposes a 303 JSON body and Location through the explicit response boundary", async () => {
    const location = "http://127.0.0.1:43123/oauth/callback?code=one&state=two"
    const requestFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ deviceId: "device-1", bindingEpoch: "2" }), {
          status: 303,
          headers: { "content-type": "application/json", location },
        }),
    )
    const client = createClient({ fetch: requestFetch })
    const response = await client.postWithResponse!<{
      deviceId: string
      bindingEpoch: string
    }>("/test/response-metadata", {})
    expect(response).toEqual({
      data: { deviceId: "device-1", bindingEpoch: "2" },
      status: 303,
      location,
    })
    expect(requestFetch).toHaveBeenCalledWith(
      "/test/response-metadata",
      expect.objectContaining({
        redirect: "follow",
        headers: expect.objectContaining({ Accept: "application/json" }),
      }),
    )
  })

  it("reads a JSON approval response with Location metadata without a redirect", async () => {
    const location = "pigclaude://authorize/callback?code=one&state=two"
    const requestFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ deviceId: "device-1", bindingEpoch: "2", location }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
    const client = createClient({ fetch: requestFetch })
    const response = await client.postWithResponse!<{
      deviceId: string
      bindingEpoch: string
      location: string
    }>("/test/response-metadata", {})
    expect(response).toEqual({
      data: { deviceId: "device-1", bindingEpoch: "2", location },
      status: 200,
      location: null,
    })
  })

  it("does not treat a 303 without Location as a successful approval", async () => {
    const requestFetch = vi.fn(
      async () => new Response(JSON.stringify({ deviceId: "device-1" }), { status: 303 }),
    )
    const client = createClient({ fetch: requestFetch })
    await expect(client.postWithResponse!("/test/response-metadata", {})).rejects.toMatchObject({
      status: 303,
    })
  })
})
