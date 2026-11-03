// 通过文件系统解析浏览器扩展目录，消除 Windows 长短路径的差异。

import { realpath } from "node:fs/promises"

/** 判断所有预期目录是否与浏览器报告的已启用扩展目录一致。 */
export async function matchingExtensionPaths(
  expected: readonly string[],
  actual: readonly string[],
  platform: NodeJS.Platform,
  resolvePath: (path: string) => Promise<string> = realpath,
): Promise<boolean> {
  if (expected.length === 0) return true
  const remaining = new Set(expected.map((path) => pathKey(path, platform)))
  const direct = actual.filter((path) => remaining.has(pathKey(path, platform)))
  for (const path of direct) {
    try {
      remaining.delete(pathKey(await resolvePath(path), platform))
    } catch {
      // 无法解析的目录不能满足预期扩展。
    }
  }
  if (remaining.size === 0) return true
  const other = actual.filter((path) => !direct.includes(path))
  if (other.length === 0) return false
  return new Promise<boolean>((resolve) => {
    let outstanding = other.length
    let finished = false
    const finish = (result: boolean): void => {
      if (finished) return
      finished = true
      resolve(result)
    }
    for (const path of other) {
      void Promise.resolve()
        .then(() => resolvePath(path))
        .then(
          (resolved) => {
            remaining.delete(pathKey(resolved, platform))
            if (remaining.size === 0) finish(true)
          },
          () => undefined,
        )
        .then(() => {
          outstanding -= 1
          if (outstanding === 0) finish(false)
        })
    }
  })
}

function pathKey(value: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") return value.replace(/\/+$/, "")
  let path = value.replaceAll("\\", "/")
  if (path.toLowerCase().startsWith("//?/unc/")) path = `//${path.slice(8)}`
  else if (path.startsWith("//?/")) path = path.slice(4)
  return path.replace(/\/+$/, "").toLowerCase()
}
