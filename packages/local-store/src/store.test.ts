// 本机账号库测试。重新打开后仍保留用户设置的指纹，目录里只留下账号和代理两个文件。

import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { LocalStore } from "./store.ts"

const fingerprint = {
  seed: "seed-a",
  brand: "Chrome",
  platform: "macOS",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: true,
  clientRectsNoise: true,
}

describe("LocalStore", () => {
  it("keeps the user-set fingerprint when the account is loaded again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    const store = new LocalStore(dir)
    await store.saveProxy({ id: "p1", url: "http://127.0.0.1:18080" })
    await store.saveAccount({
      id: "acc-1",
      enabled: true,
      credential: "oauth-secret",
      proxyId: "p1",
      fingerprint,
      exhaustedUntil: null,
    })
    const again = new LocalStore(dir)
    expect(await again.getAccount("acc-1")).toMatchObject({
      credential: "oauth-secret",
      fingerprint,
    })
    const names = await readdir(dir)
    expect(names.sort()).toEqual(["accounts.json", "proxies.json"])
  })
})
