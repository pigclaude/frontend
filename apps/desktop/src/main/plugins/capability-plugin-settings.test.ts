// 验证重新打开插件设置后保留普通值和密钥状态，并使用独立的加密文件供运行时读回。
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { parseCapabilityPluginManifest } from "./capability-plugin-manifest"
import { capabilityPluginStoragePaths } from "./capability-plugin-paths"
import { createCapabilityPluginSecrets } from "./capability-plugin-secrets"
import { CapabilityPluginSettings } from "./capability-plugin-settings"

const manifest = parseCapabilityPluginManifest({
  apiVersion: 1,
  id: "fixture-settings",
  name: "声明设置",
  version: "1.0.0",
  pigclaudeVersion: "*",
  entry: "index.mjs",
  permissions: ["secrets"],
  settings: [
    { key: "language", label: "语言", type: "text", defaultValue: "中文" },
    { key: "credential", label: "访问密钥", type: "secret" },
  ],
})

it("持久化普通设置与加密密钥，可信界面回读只见配置状态", async () => {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-plugin-settings-"))
  const fixture = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: vi.fn(() => Buffer.from("opaque fixture ciphertext")),
    decryptString: vi.fn(() => "fixture-value"),
  }
  try {
    const settings = new CapabilityPluginSettings(
      root,
      createCapabilityPluginSecrets(root, fixture),
    )
    await expect(settings.read(manifest)).resolves.toEqual({
      values: { language: "中文" },
      configuredSecrets: [],
    })
    await settings.set(manifest, "language", "English")
    await settings.set(manifest, "credential", "fixture-value")
    expect(fixture.encryptString).toHaveBeenCalledWith("fixture-value")

    const reopenedSecrets = createCapabilityPluginSecrets(root, fixture)
    const reopened = new CapabilityPluginSettings(root, reopenedSecrets)
    await expect(reopened.read(manifest)).resolves.toEqual({
      values: { language: "English" },
      configuredSecrets: ["credential"],
    })
    expect(fixture.decryptString).not.toHaveBeenCalled()
    await expect(reopenedSecrets.read(manifest.id, "credential")).resolves.toBe("fixture-value")
    await expect(reopenedSecrets.read("different-plugin", "credential")).resolves.toBeNull()

    const { dataDirectory, secretsFile } = capabilityPluginStoragePaths(root, manifest.id)
    expect(await readFile(secretsFile, "utf8")).not.toContain("fixture-value")
    const normalFile = await readFile(join(dataDirectory, "settings.json"), "utf8")
    expect(normalFile).not.toContain("credential")
    await expect(reopened.set(manifest, "credential", null)).resolves.toEqual({
      values: { language: "English" },
      configuredSecrets: [],
    })
    await expect(reopenedSecrets.read(manifest.id, "credential")).resolves.toBeNull()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
