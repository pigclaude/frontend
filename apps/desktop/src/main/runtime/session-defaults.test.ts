// 负责验证新会话默认设置的存储和校验：重启后还在、只收合法的修改、损坏文件按内置默认处理。

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  builtinSessionDefaults,
  isSessionDefaults,
  readSessionDefaultsPatch,
} from "../../session-defaults-contract"
import { SessionDefaultsStore } from "./session-defaults"

let directory: string
let filePath: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pigclaude-session-defaults-"))
  filePath = join(directory, "nested", "session-defaults.json")
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("session defaults store", () => {
  it("starts from the builtin defaults when nothing is stored", async () => {
    await expect(new SessionDefaultsStore({ filePath }).get()).resolves.toEqual(
      builtinSessionDefaults,
    )
  })

  it("keeps saved defaults across instances in an owner-only file", async () => {
    await new SessionDefaultsStore({ filePath }).update({ model: "claude-opus" })
    const saved = await new SessionDefaultsStore({ filePath }).update({
      permissionMode: "acceptEdits",
      accountId: "acc-work",
    })

    expect(saved).toEqual({
      model: "claude-opus",
      permissionMode: "acceptEdits",
      accountId: "acc-work",
    })
    await expect(new SessionDefaultsStore({ filePath }).get()).resolves.toEqual(saved)
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
  })

  it("keeps both changes when two updates arrive together", async () => {
    const store = new SessionDefaultsStore({ filePath })

    await Promise.all([
      store.update({ model: "claude-opus" }),
      store.update({ permissionMode: "auto" }),
    ])

    await expect(new SessionDefaultsStore({ filePath }).get()).resolves.toEqual({
      ...builtinSessionDefaults,
      model: "claude-opus",
      permissionMode: "auto",
    })
  })

  it("clears a preference back to following Claude Code and automatic accounts", async () => {
    const store = new SessionDefaultsStore({ filePath })
    await store.update({ model: "claude-opus", accountId: "acc-work" })

    await expect(store.update({ model: null, accountId: null })).resolves.toEqual(
      builtinSessionDefaults,
    )
    const raw: unknown = JSON.parse(await readFile(filePath, "utf8"))
    expect(raw).toEqual(builtinSessionDefaults)
  })

  it("treats a corrupt file as unset and replaces only invalid fields of a foreign one", async () => {
    const store = new SessionDefaultsStore({ filePath })
    await store.update({})
    await writeFile(filePath, "{not json", "utf8")
    await expect(store.get()).resolves.toEqual(builtinSessionDefaults)

    await writeFile(
      filePath,
      JSON.stringify({ model: 42, permissionMode: "plan", accountId: "acc-work", token: "x" }),
      "utf8",
    )
    await expect(store.get()).resolves.toEqual({ ...builtinSessionDefaults, accountId: "acc-work" })
  })
})

describe("session defaults patch", () => {
  it("accepts the three fields with valid values", () => {
    expect(
      readSessionDefaultsPatch({ model: "claude-opus", permissionMode: "auto", accountId: null }),
    ).toEqual({ model: "claude-opus", permissionMode: "auto", accountId: null })
    expect(readSessionDefaultsPatch({ permissionMode: "bypassPermissions" })).toEqual({
      permissionMode: "bypassPermissions",
    })
  })

  it("rejects plan mode, unknown fields and malformed ids", () => {
    const invalid: unknown[] = [
      null,
      [],
      "default",
      { permissionMode: "plan" },
      { permissionMode: "dontAsk" },
      { proxy: "http://127.0.0.1:7890" },
      { model: "" },
      { model: "   " },
      { model: " claude-opus" },
      { model: "m".repeat(201) },
      { model: "a\nb" },
      { accountId: 7 },
      { accountId: "a".repeat(129) },
    ]
    for (const value of invalid) {
      expect(() => readSessionDefaultsPatch(value)).toThrow("SESSION_DEFAULTS_INVALID")
    }
  })

  it("recognizes only complete defaults", () => {
    expect(isSessionDefaults(builtinSessionDefaults)).toBe(true)
    expect(isSessionDefaults({ model: null, permissionMode: "default" })).toBe(false)
    expect(isSessionDefaults({ ...builtinSessionDefaults, permissionMode: "plan" })).toBe(false)
  })
})
