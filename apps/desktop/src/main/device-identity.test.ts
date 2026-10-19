// 负责验证不同安全仓库生成独立设备身份，并在同一仓库重启后恢复身份。
import { describe, expect, it } from "vitest"
import { readOrCreateDeviceIdentity } from "./device-identity"
import type { SecretVault } from "./secret-vault"

function vault(): SecretVault {
  const values = new Map<string, string>()
  return {
    async get(key) {
      return values.get(key) ?? null
    },
    async set(key, value) {
      values.set(key, value)
    },
    async delete(key) {
      values.delete(key)
    },
  }
}

describe("持久设备身份", () => {
  it("同一安全仓库重启恢复，不同安装不能共享全局常量", async () => {
    const firstVault = vault()
    const first = await readOrCreateDeviceIdentity(firstVault)
    expect(await readOrCreateDeviceIdentity(firstVault)).toEqual(first)
    const second = await readOrCreateDeviceIdentity(vault())
    expect(second.deviceId).not.toBe(first.deviceId)
    expect(second.deviceFingerprintHash).not.toBe(first.deviceFingerprintHash)
    expect(first.deviceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.deviceFingerprintHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("损坏身份不能悄悄重新生成并替换现有设备", async () => {
    const store = vault()
    await store.set("device:identity", "broken")
    await expect(readOrCreateDeviceIdentity(store)).rejects.toThrow()
  })
})
