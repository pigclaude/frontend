// 负责验证授权秘密写入加密文件时不泄露明文，并支持读取与删除。
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { FileSecretVault, type SafeStoragePort } from "./secret-vault"

function fakeSafeStorage(): SafeStoragePort {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => {
      const decoded = value.toString("utf8")
      if (!decoded.startsWith("encrypted:")) throw new Error("invalid encrypted secret")
      return decoded.slice("encrypted:".length)
    },
  }
}

describe("FileSecretVault", () => {
  it("没有保存的设备授权时无需访问钥匙串", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pigclaude-vault-"))
    const isEncryptionAvailable = vi.fn(async () => false)
    const vault = new FileSecretVault(join(dir, "secrets.json"), {
      ...fakeSafeStorage(),
      isEncryptionAvailable,
    })

    await expect(vault.get("membership:session")).resolves.toBeNull()
    expect(isEncryptionAvailable).not.toHaveBeenCalled()
  })

  it("does not write the token in plaintext and can restore it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pigclaude-vault-"))
    const path = join(dir, "secrets.json")
    const vault = new FileSecretVault(path, fakeSafeStorage())

    await vault.set("session:refresh", "refresh-token-secret")
    const file = await readFile(path, "utf8")
    const restored = await new FileSecretVault(path, fakeSafeStorage()).get("session:refresh")

    expect(file).not.toContain("refresh-token-secret")
    expect(restored).toBe("refresh-token-secret")
  })

  it("removes a secret and rejects malformed encrypted data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pigclaude-vault-"))
    const path = join(dir, "secrets.json")
    const vault = new FileSecretVault(path, fakeSafeStorage())

    await vault.set("session:access", "access-token-secret")
    await vault.delete("session:access")
    expect(await vault.get("session:access")).toBeNull()

    await vault.set("session:bad", "bad-secret")
    const file = JSON.parse(await readFile(path, "utf8")) as Record<string, string>
    file["session:bad"] = "not-base64"
    await import("node:fs/promises").then(({ writeFile }) => writeFile(path, JSON.stringify(file)))
    await expect(vault.get("session:bad")).rejects.toThrow()
  })

  it("preserves the old session when an asynchronous keychain read is refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pigclaude-vault-"))
    const path = join(dir, "secrets.json")
    const previousStorage = fakeSafeStorage()
    await new FileSecretVault(path, previousStorage).set("session", "saved-session")
    const previousFile = await readFile(path, "utf8")
    let allowed = false
    const vault = new FileSecretVault(path, {
      ...previousStorage,
      isEncryptionAvailable: async () => allowed,
      decryptString: async (value) => previousStorage.decryptString(value),
    })

    await expect(vault.get("session")).rejects.toThrow("系统安全存储不可用")
    expect(await readFile(path, "utf8")).toBe(previousFile)
    allowed = true
    await expect(vault.get("session")).resolves.toBe("saved-session")
  })

  it("serializes asynchronous encryption and publishes complete bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pigclaude-vault-"))
    const path = join(dir, "secrets.json")
    const previousStorage = fakeSafeStorage()
    const vault = new FileSecretVault(path, {
      ...previousStorage,
      isEncryptionAvailable: async () => true,
      encryptString: async (value) => previousStorage.encryptString(value),
    })

    const writes = [vault.set("session", "first"), vault.set("session", "second")]
    await Promise.all(writes)
    await expect(vault.get("session")).resolves.toBe("second")
  })
})
