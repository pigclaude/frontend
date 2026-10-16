// 权限客户端测试。拒绝的许可证不能开会话，离线时只沿用上次允许的结果。明确拒绝和 HTTP 4xx 会清掉这次允许。

import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { checkPermission, mayStartSession } from "./permission.ts"

describe("permission", () => {
  it("refuses to start a session when the license is denied", async () => {
    const dir = await mkdtemp(join(tmpdir(), "perm-"))
    const decision = await checkPermission({
      endpoint: "http://license.test",
      license: "nope",
      cachePath: join(dir, "permission.json"),
      fetchImpl: async () =>
        new Response(JSON.stringify({ allowed: false, checkedAt: "2026-10-17T00:00:00Z" })),
    })
    expect(decision).toEqual({
      allowed: false,
      checkedAt: "2026-10-17T00:00:00Z",
      source: "remote",
    })
    expect(mayStartSession(decision)).toBe(false)
  })

  it("uses the last allowed result when the server cannot be reached", async () => {
    const dir = await mkdtemp(join(tmpdir(), "perm-"))
    const cachePath = join(dir, "permission.json")
    await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      fetchImpl: async () =>
        new Response(JSON.stringify({ allowed: true, checkedAt: "2026-10-17T01:00:00Z" })),
    })
    const decision = await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      fetchImpl: async () => {
        throw new Error("offline")
      },
    })
    expect(decision).toEqual({
      allowed: true,
      checkedAt: "2026-10-17T01:00:00Z",
      source: "cache",
    })
    expect(mayStartSession(decision)).toBe(true)
    expect(await readFile(cachePath, "utf8")).toContain("lic-ok")
  })

  it("does not invent an allow when there is no cache and the server is down", async () => {
    const dir = await mkdtemp(join(tmpdir(), "perm-"))
    const decision = await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath: join(dir, "missing.json"),
      fetchImpl: async () => {
        throw new Error("offline")
      },
    })
    expect(mayStartSession(decision)).toBe(false)
    expect(decision.source).toBe("cache")
    expect(decision.allowed).toBe(false)
  })

  it("does not replay a cached allow when a success response is not an allow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "perm-"))
    const cachePath = join(dir, "permission.json")
    await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      fetchImpl: async () =>
        new Response(JSON.stringify({ allowed: true, checkedAt: "2026-10-17T01:00:00Z" })),
    })
    const decision = await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      now: () => new Date("2026-10-17T02:00:00Z"),
      fetchImpl: async () => new Response(JSON.stringify({ allowed: false }), { status: 200 }),
    })
    expect(decision).toEqual({
      allowed: false,
      checkedAt: "2026-10-17T02:00:00.000Z",
      source: "remote",
    })
    expect(mayStartSession(decision)).toBe(false)
    const offline = await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      fetchImpl: async () => {
        throw new Error("offline")
      },
    })
    expect(offline.allowed).toBe(false)
    expect(mayStartSession(offline)).toBe(false)
  })

  it("drops the cached allow after a well-formed denial, even if the next check throws", async () => {
    const dir = await mkdtemp(join(tmpdir(), "perm-"))
    const cachePath = join(dir, "permission.json")
    await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      fetchImpl: async () =>
        new Response(JSON.stringify({ allowed: true, checkedAt: "2026-10-17T01:00:00Z" })),
    })
    const denial = await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      fetchImpl: async () =>
        new Response(JSON.stringify({ allowed: false, checkedAt: "2026-10-17T02:00:00Z" })),
    })
    expect(denial).toEqual({
      allowed: false,
      checkedAt: "2026-10-17T02:00:00Z",
      source: "remote",
    })
    const offline = await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      fetchImpl: async () => {
        throw new Error("offline")
      },
    })
    expect(offline.allowed).toBe(false)
    expect(mayStartSession(offline)).toBe(false)
  })

  it("does not replay a cached allow after HTTP 403", async () => {
    const dir = await mkdtemp(join(tmpdir(), "perm-"))
    const cachePath = join(dir, "permission.json")
    await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      fetchImpl: async () =>
        new Response(JSON.stringify({ allowed: true, checkedAt: "2026-10-17T01:00:00Z" })),
    })
    const decision = await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      now: () => new Date("2026-10-17T03:00:00Z"),
      fetchImpl: async () => new Response("denied", { status: 403 }),
    })
    expect(decision).toEqual({
      allowed: false,
      checkedAt: "2026-10-17T03:00:00.000Z",
      source: "remote",
    })
    expect(mayStartSession(decision)).toBe(false)
    const offline = await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      fetchImpl: async () => {
        throw new Error("offline")
      },
    })
    expect(offline.allowed).toBe(false)
    expect(mayStartSession(offline)).toBe(false)
  })

  it("reuses the cached allow after HTTP 503", async () => {
    const dir = await mkdtemp(join(tmpdir(), "perm-"))
    const cachePath = join(dir, "permission.json")
    await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      fetchImpl: async () =>
        new Response(JSON.stringify({ allowed: true, checkedAt: "2026-10-17T01:00:00Z" })),
    })
    const decision = await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    })
    expect(decision).toEqual({
      allowed: true,
      checkedAt: "2026-10-17T01:00:00Z",
      source: "cache",
    })
    expect(mayStartSession(decision)).toBe(true)
    expect(await readFile(cachePath, "utf8")).toContain("lic-ok")
  })

  it("reuses the last allow when the permission check does not settle in 10 seconds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "perm-"))
    const cachePath = join(dir, "permission.json")
    await checkPermission({
      endpoint: "http://license.test",
      license: "lic-ok",
      cachePath,
      fetchImpl: async () =>
        new Response(JSON.stringify({ allowed: true, checkedAt: "2026-10-17T01:00:00Z" })),
    })
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      const pending = checkPermission({
        endpoint: "http://license.test",
        license: "lic-ok",
        cachePath,
        fetchImpl: () => new Promise<Response>(() => undefined),
      })
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(pending).resolves.toEqual({
        allowed: true,
        checkedAt: "2026-10-17T01:00:00Z",
        source: "cache",
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
