// 约束能力插件标识和模块路径在支持的平台上都定位到同一个文件。

import { join } from "node:path"

function portablePart(value: string): boolean {
  return (
    /^[A-Za-z0-9_.@-]+$/.test(value) &&
    value !== "." &&
    value !== ".." &&
    !value.endsWith(".") &&
    !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value)
  )
}

/** 插件标识可作为普通目录名，且在大小写不敏感的文件系统上无歧义。 */
export function isCapabilityPluginId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(value) &&
    portablePart(value)
  )
}

/** 模块只能是包内的 JS/ESM 文件，路径与沙箱模块协议共用正斜杠格式。 */
export function isCapabilityPluginModulePath(path: string): boolean {
  return path.length <= 240 && /\.m?js$/.test(path) && path.split("/").every(portablePart)
}

/** 安装根下每个插件的数据与独立加密文件；保留数据时密钥仍可独立删除。 */
export function capabilityPluginStoragePaths(root: string, id: string) {
  if (!isCapabilityPluginId(id)) throw new Error("PLUGIN_ID_INVALID")
  return {
    dataDirectory: join(root, "data", id),
    secretsFile: join(root, "secrets", id, "values.json"),
  }
}
