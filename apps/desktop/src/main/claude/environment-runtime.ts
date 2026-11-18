// 将实际浏览器路径与固定开发包清单绑定，自检不会执行无法验证的浏览器。

import { resolve, normalize, sep } from "node:path"
import { pigbrowserArtifact, verifyPigbrowserPackage } from "../../../pigbrowser-resources.cjs"

/** 验证实际入口属于当前平台的完整固定包，失败只返回脱敏的否定结果。 */
export async function approvedEnvironmentBrowser(
  binary: string,
  platform: NodeJS.Platform,
  arch: string,
): Promise<boolean> {
  try {
    const target = `${platform}-${arch}`
    const artifact = pigbrowserArtifact(target)
    const suffix = sep + normalize(artifact.executable)
    const path = resolve(binary)
    if (!path.endsWith(suffix)) return false
    const root = path.slice(0, -suffix.length)
    const verified = await verifyPigbrowserPackage(root, target, { allowLinuxSandboxLink: true })
    return resolve(verified.executable) === path
  } catch {
    return false
  }
}
