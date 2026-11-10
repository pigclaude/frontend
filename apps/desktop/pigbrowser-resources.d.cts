// 为构建与运行时共用的固定 PigBrowser 清单检查声明严格类型。

/** 返回资源合同固定的 native 内核版本。 */
export function pigbrowserVersion(): string

/** 返回已批准平台开发包的固定身份和入口。 */
export function pigbrowserArtifact(target: string): {
  archive: string
  sha256: string
  manifestSha256: string
  executable: string
}

/** 核对完整开发包后返回入口和核验项数；任何差异均拒绝。 */
export function verifyPigbrowserPackage(
  root: string,
  target: string,
): Promise<{
  executable: string
  entries: number
}>
