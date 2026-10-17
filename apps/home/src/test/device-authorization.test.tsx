// 负责验证 home 设备授权读取、replace flag、approve 请求和脱敏展示。
import { describe, expect, it, vi } from "vitest"
import { createHomeApi } from "@pigclaude/api/home"
import type { HttpClient } from "@pigclaude/api"
import { deviceAuthorizationFixture } from "@pigclaude/contracts/fixtures/phase1-contract-fixtures"
import { maskDeviceValue } from "@/lib/device-mask"

function fixtureClient(): HttpClient {
  return {
    get: vi.fn(async () => ({
      flowId: "flow-1",
      deviceId: "device-super-secret-1234",
      deviceFingerprintHash: "fingerprint-secret-5678",
      status: "pending",
      existingDeviceId: "old-device-4321",
      existingBindingEpoch: "8",
      requiresReplace: true,
      expiresAt: null,
    })),
    post: vi.fn(async () => ({ deviceId: "device-super-secret-1234", bindingEpoch: "9" })),
    postWithResponse: vi.fn(async () => ({
      data: { deviceId: "device-super-secret-1234", bindingEpoch: "9" },
      status: 303,
      location: "http://127.0.0.1:43123/oauth/callback?code=one&state=flow-state",
    })),
    postForm: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as unknown as HttpClient
}

describe("home device authorization flow", () => {
  it("reads replace state and approves with explicit replaceExisting", async () => {
    const client = fixtureClient()
    const api = createHomeApi(client)
    const flow = await api.authorizations.get("flow-1")
    const result = await api.authorizations.approve("flow-1", {
      replaceExisting: true,
      state: "flow-state",
    })
    expect(flow.requiresReplace).toBe(true)
    expect(client.postWithResponse).toHaveBeenCalledWith("/v1/authorizations/flow-1/approve", {
      replaceExisting: true,
      state: "flow-state",
    })
    expect(result.bindingEpoch).toBe("9")
    expect(result.location).toContain("state=flow-state")
  })

  it("matches the shared nullable contract fixture", () => {
    expect(deviceAuthorizationFixture.status).toBe("pending")
    expect(deviceAuthorizationFixture.existingDeviceId).toBeNull()
    expect(deviceAuthorizationFixture.existingBindingEpoch).toBeNull()
  })

  it("only exposes a masked device value in the UI helper", () => {
    expect(maskDeviceValue("device-super-secret-1234")).toBe("devi••••1234")
    expect(maskDeviceValue("tiny")).toBe("••••")
    expect(maskDeviceValue("device-super-secret-1234")).not.toContain("secret")
  })
})
