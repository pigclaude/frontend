// 负责从主进程安全仓库恢复当前安装的设备身份。
import { createHash, randomUUID } from "node:crypto"
import type { SecretVault } from "./secret-vault"

/** 当前安装的脱敏设备标识和指纹。 */
export type DeviceIdentity = { deviceId: string; deviceFingerprintHash: string }

/** 恢复同一安装的设备身份，新安装只生成一次并由 safeStorage 持久保存。 */
export async function readOrCreateDeviceIdentity(vault: SecretVault): Promise<DeviceIdentity> {
  const stored = await vault.get("device:identity")
  if (stored !== null) {
    const value: unknown = JSON.parse(stored)
    if (
      typeof value !== "object" ||
      value === null ||
      !("deviceId" in value) ||
      typeof value.deviceId !== "string" ||
      !value.deviceId ||
      !("deviceFingerprintHash" in value) ||
      typeof value.deviceFingerprintHash !== "string" ||
      !value.deviceFingerprintHash
    )
      throw new Error("本机设备身份格式无效")
    return { deviceId: value.deviceId, deviceFingerprintHash: value.deviceFingerprintHash }
  }
  const identity = {
    deviceId: randomUUID(),
    deviceFingerprintHash: createHash("sha256").update(randomUUID()).digest("hex"),
  }
  await vault.set("device:identity", JSON.stringify(identity))
  return identity
}
