// 用双独占PG/Redis验收给出的真实合成凭据驱动桌面组合根；只输出公开状态与调用计数。
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { expect, it } from "vitest"
import { LocalStore } from "@pigclaude/local-store"
import { createDesktopComposition, type DesktopComposition } from "../src/main/composition"
import { FileSecretVault } from "../src/main/secret-vault"
import { parseOAuthDesktopSession } from "../src/main/authorization/oauth-session"
import { fixtureSafeStorage } from "../src/main/testing/profile-fixture"
import { seedCrossEnvironmentLocalState } from "../src/main/testing/cross-environment-client-fixture"

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

async function inputContext() {
  const inputFile = process.env.PIGCLAUDE_CROSS_ENV_CLIENT_INPUT
  const doneFile = process.env.PIGCLAUDE_CROSS_ENV_CLIENT_DONE
  if (
    !inputFile ||
    !doneFile ||
    !isAbsolute(inputFile) ||
    !isAbsolute(doneFile) ||
    dirname(inputFile) !== dirname(doneFile) ||
    resolve(inputFile) === resolve(doneFile)
  )
    throw new Error("OWNED_CROSS_ENVIRONMENT_INPUT_REQUIRED")
  const file = await lstat(inputFile)
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    (file.mode & 0o7777) !== 0o600 ||
    file.size > 65536 ||
    (await realpath(inputFile)) !== inputFile
  )
    throw new Error("INVALID_CROSS_ENVIRONMENT_INPUT")
  const value: unknown = JSON.parse(await readFile(inputFile, "utf8"))
  if (
    !record(value) ||
    value.purpose !== "same-issuer-cross-environment" ||
    typeof value.authOrigin !== "string" ||
    value.authOrigin !== value.apiOrigin
  )
    throw new Error("INVALID_CROSS_ENVIRONMENT_INPUT")
  const origin = new URL(value.authOrigin)
  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    !origin.port ||
    origin.origin !== value.authOrigin
  )
    throw new Error("LOOPBACK_CROSS_ENVIRONMENT_REQUIRED")
  const oldSession = parseOAuthDesktopSession(JSON.stringify(value.oldSession))
  const newSession = parseOAuthDesktopSession(JSON.stringify(value.newSession))
  if (!oldSession || !newSession) throw new Error("INVALID_SYNTHETIC_OAUTH_SESSION")
  return { authOrigin: origin.origin, oldSession, newSession, doneFile }
}

it("new environment rejects old credentials once, restart does not replay, and new authorization succeeds", async () => {
  const input = await inputContext()
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-cross-env-live-client-"))
  const vaultPath = join(directory, "secrets.json")
  const vault = new FileSecretVault(vaultPath, fixtureSafeStorage)
  const localStore = new LocalStore(directory)
  const preserved = await seedCrossEnvironmentLocalState({ directory, vault, localStore })
  const calls: { path: string; grantType: string | null }[] = []
  const apps: DesktopComposition[] = []
  let verified = false
  let removedBeforeRefresh = false
  const stableDevice = { deviceId: input.oldSession.deviceId, platform: "darwin" as const }
  const identity = { read: async () => ({ ...stableDevice }) }
  const fetcher: typeof fetch = async (url, init) => {
    expect(init?.credentials).toBe("omit")
    expect(init?.redirect).toBe("error")
    const path = new URL(String(url)).pathname
    const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "")
    const grantType = form.get("grant_type")
    calls.push({ path, grantType })
    if (grantType === "refresh_token") {
      removedBeforeRefresh =
        (await new FileSecretVault(vaultPath, fixtureSafeStorage).get("membership:session")) ===
        null
    }
    return fetch(url, init)
  }
  const create = () => {
    const app = createDesktopComposition({
      vault: new FileSecretVault(vaultPath, fixtureSafeStorage),
      localStore,
      deviceIdentity: identity,
      authOrigin: input.authOrigin,
      apiOptions: { baseUrl: input.authOrigin, fetcher },
    })
    apps.push(app)
    return app
  }
  const refreshCalls = () => calls.filter((call) => call.grantType === "refresh_token").length
  try {
    for (const key of ["userId", "authVersion", "bindingEpoch", "deviceId"] as const)
      expect(input.newSession[key]).toBe(input.oldSession[key])
    expect(input.oldSession.userId).toMatch(/^[1-9][0-9]*$/)
    expect(input.oldSession.accessToken).not.toBe(input.newSession.accessToken)
    expect(input.oldSession.refreshToken).not.toBe(input.newSession.refreshToken)
    expect(input.oldSession.accessTokenExpiresAt).toBeGreaterThan(Date.now())
    await vault.set("membership:session", JSON.stringify(input.oldSession))
    const original = create()
    expect(await original.resume()).toMatchObject({
      state: "verification_required",
      errorCode: "invalid_grant",
    })
    expect(refreshCalls()).toBe(1)
    expect(removedBeforeRefresh).toBe(true)
    expect(await vault.get("membership:session")).toBeNull()
    await original.dispose()
    const restarted = create()
    const beforeRestart = calls.length
    expect(await restarted.resume()).toMatchObject({ state: "signed_out" })
    expect(calls.length).toBe(beforeRestart)
    expect(refreshCalls()).toBe(1)
    expect(await identity.read()).toEqual(stableDevice)
    expect(await readFile(join(directory, "accounts.json"))).toEqual(preserved.accounts)
    expect(await readFile(join(directory, "proxies.json"))).toEqual(preserved.proxies)
    expect(await vault.get("authorization:claude-account:local-claude")).toBe(
      "synthetic-claude-vault-secret",
    )
    expect(await vault.get("device:identity")).toBe("independent-device-sentinel")
    await restarted.membershipGate.acceptAuthorization(input.newSession)
    expect(await restarted.resume()).toMatchObject({ state: "active" })
    expect(await restarted.runAuthorized(async () => "new-environment-authorized")).toBe(
      "new-environment-authorized",
    )
    expect(refreshCalls()).toBe(1)
    expect(await identity.read()).toEqual(stableDevice)
    verified = true
  } finally {
    for (const app of apps) await app.dispose()
    await writeFile(
      input.doneFile,
      JSON.stringify({
        purpose: "same-issuer-cross-environment",
        clientVerified: verified,
        oldRefreshCalls: refreshCalls(),
        removedBeforeRefresh,
      }) + "\n",
      { mode: 0o600, flag: "wx" },
    )
    await rm(directory, { recursive: true, force: true })
  }
})
