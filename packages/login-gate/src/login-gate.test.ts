// 登录前出口核对测试。出口不一致时不保存凭据，并返回请勿登录。

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { gateLogin, saveAuthorization } from "./login-gate.ts"
import { LocalStore } from "@pigclaude/local-store"

describe("login gate", () => {
  it("does not save a credential or offer a link when the exits differ", async () => {
    const gate = gateLogin({ bridgeExitIp: "1.1.1.1", daemonExitIp: "2.2.2.2" })
    expect(gate).toEqual({ ok: false, message: "请勿登录" })
    const dir = await mkdtemp(join(tmpdir(), "login-"))
    const store = new LocalStore(dir)
    const result = await saveAuthorization({
      gate,
      store,
      account: {
        id: "acc-1",
        enabled: true,
        credential: "should-not-save",
        proxyId: "p1",
        exhaustedUntil: null,
        fingerprint: {
          seed: "seed-a",
          brand: "Chrome",
          platform: "macOS",
          lang: "en-US",
          timezone: "America/Los_Angeles",
          canvasNoise: true,
          clientRectsNoise: true,
        },
      },
    })
    expect(result).toBe("请勿登录")
    expect(await store.getAccount("acc-1")).toBeNull()
  })
})
