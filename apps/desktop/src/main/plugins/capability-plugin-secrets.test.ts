// 验证插件密钥的并发写入不会丢数据，Linux 缺少系统密钥库时禁止使用降级后端。
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { createCapabilityPluginSecrets } from "./capability-plugin-secrets"

const fixtureStorage = () => ({
  getSelectedStorageBackend: vi.fn(() => "gnome_libsecret"),
  isEncryptionAvailable: () => true,
  encryptString: vi.fn((value: string) =>
    Buffer.from(Buffer.from(value).map((byte) => byte ^ 0xa5)),
  ),
  decryptString: vi.fn((value: Buffer) => Buffer.from(value.map((byte) => byte ^ 0xa5)).toString()),
})

it("两个使用方共享写队列，另一个插件和普通设置视图读不到值", async () => {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-shared-plugin-secrets-"))
  const storage = fixtureStorage()
  try {
    const secrets = createCapabilityPluginSecrets(root, storage, "linux")
    await Promise.all([
      secrets.write("fixture", "form", "form-value"),
      secrets.write("fixture", "runtime", "runtime-value"),
    ])
    await expect(secrets.keys("fixture")).resolves.toEqual(["form", "runtime"])
    expect(storage.decryptString).not.toHaveBeenCalled()
    await expect(secrets.read("fixture", "form")).resolves.toBe("form-value")
    await expect(secrets.read("fixture", "runtime")).resolves.toBe("runtime-value")
    await expect(secrets.read("other-fixture", "form")).resolves.toBeNull()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it("Linux basic_text 即使声称加密可用也禁止保存", async () => {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-shared-plugin-secrets-"))
  const storage = fixtureStorage()
  storage.getSelectedStorageBackend.mockReturnValue("basic_text")
  try {
    const secrets = createCapabilityPluginSecrets(root, storage, "linux")
    await expect(secrets.write("fixture", "example", "synthetic")).rejects.toThrow(
      "PLUGIN_SECRET_STORAGE_UNAVAILABLE",
    )
    await expect(secrets.keys("fixture")).resolves.toEqual([])
    expect(storage.encryptString).not.toHaveBeenCalled()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
