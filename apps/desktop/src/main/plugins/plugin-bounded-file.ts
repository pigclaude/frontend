// 在打开的句柄上校验普通文件身份，并限制读取的字节数。

import { constants } from "node:fs"
import { open, realpath, stat } from "node:fs/promises"
import { relative } from "node:path"

/** 不沿链接跨出给定的规范路径；调用方可以进一步禁止硬链接。 */
export async function readBoundedPluginFile(
  path: string,
  limit: number,
  singleLink = false,
): Promise<Buffer> {
  if (relative(path, await realpath(path)) !== "") throw new Error("PLUGIN_BUNDLE_UNSAFE")
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  )
  try {
    const info = await handle.stat()
    const resolved = await realpath(path)
    const observed = await stat(resolved)
    if (
      !info.isFile() ||
      relative(path, resolved) !== "" ||
      info.dev !== observed.dev ||
      info.ino !== observed.ino ||
      (singleLink && observed.nlink > 1)
    )
      throw new Error("PLUGIN_BUNDLE_UNSAFE")
    if (info.size > limit) throw new Error("PLUGIN_BUNDLE_TOO_LARGE")
    const bytes = Buffer.alloc(info.size + 1)
    let used = 0
    while (used < bytes.length) {
      const { bytesRead } = await handle.read(bytes, used, bytes.length - used, null)
      if (bytesRead === 0) break
      used += bytesRead
    }
    if (used !== info.size) throw new Error("PLUGIN_BUNDLE_INVALID")
    return bytes.subarray(0, used)
  } finally {
    await handle.close()
  }
}
