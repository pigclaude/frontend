// 权限客户端测试。拒绝的许可证不能开会话，离线时只沿用上次允许的结果。

import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
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
  })
})
