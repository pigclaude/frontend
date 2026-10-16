// 本机账号库测试。重新打开后仍保留用户设置的指纹；两次保存交错时两条记录都还在。

import { mkdtemp, readFile, readdir } from "node:fs/promises"
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

  it("keeps both records when two saves of the same file overlap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    const store = new LocalStore(dir)
    const firstAccount = store.saveAccount(account("acc-1"))
    const secondAccount = store.saveAccount(account("acc-2"))
    await Promise.all([firstAccount, secondAccount])
    const accounts = await store.listAccounts()
    expect(accounts.map((item) => item.id).sort()).toEqual(["acc-1", "acc-2"])

    const firstProxy = store.saveProxy({ id: "p1", url: "http://127.0.0.1:1" })
    const secondProxy = store.saveProxy({ id: "p2", url: "http://127.0.0.1:2" })
    await Promise.all([firstProxy, secondProxy])
    expect((await proxyIds(dir)).sort()).toEqual(["p1", "p2"])
  })
})

function account(id: string) {
  return {
    id,
    enabled: true,
    credential: id,
    proxyId: "p1",
    fingerprint,
    exhaustedUntil: null,
  }
}

async function proxyIds(dir: string): Promise<string[]> {
  const parsed: unknown = JSON.parse(await readFile(join(dir, "proxies.json"), "utf8"))
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((item) => {
    if (isIdRecord(item)) return [item.id]
    return []
  })
}

function isIdRecord(value: unknown): value is { id: string } {
  return (
    typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
  )
}
