// 负责验证授权秘密写入加密文件时不泄露明文，并支持读取与删除。
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
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
})
