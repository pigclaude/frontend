// 读取项目范围内的本地配置，防止目录别名或读取竞态改变已确认的路径。
import { lstat, open, stat } from "node:fs/promises"
import {
  canonicalProjectPath,
  containsProjectPath,
  isMissingProjectPath,
} from "./project-configuration-scope"

const maxProjectConfigurationFileBytes = 512 * 1024

/** 配置文件可使用的范围，不含用户自己的个人配置。 */
export type ProjectConfigurationFileScope = { root: string; personalDirectory: string }

/** 给项目报告用的文件标识和只在主进程读取的文本。 */
export type ProjectConfigurationFile = { path: string; text: string | null }

/** 读取范围内现存的普通配置文件，拒绝不匹配的文件身份并限制字节数。 */
export async function readProjectConfigurationFile(
  path: string,
  display: string,
  scope: ProjectConfigurationFileScope,
): Promise<ProjectConfigurationFile | null> {
  try {
    await lstat(path)
  } catch (error) {
    return isMissingProjectPath(error) ? null : { path: display, text: null }
  }
  try {
    const canonical = await scopedProjectPath(path, scope)
    if (canonical === null) return { path: display, text: null }
    const expected = await stat(canonical)
    if (!expected.isFile() || expected.size > maxProjectConfigurationFileBytes)
      return { path: display, text: null }
    const file = await open(canonical, "r")
    try {
      const info = await file.stat()
      if (
        !info.isFile() ||
        info.size > maxProjectConfigurationFileBytes ||
        info.ino !== expected.ino ||
        info.dev !== expected.dev
      ) {
        return { path: display, text: null }
      }
      const buffer = Buffer.alloc(info.size + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
        if (bytesRead === 0) break
        length += bytesRead
      }
      return {
        path: display,
        text: length === buffer.length ? null : buffer.toString("utf8", 0, length),
      }
    } finally {
      await file.close()
    }
  } catch {
    return { path: display, text: null }
  }
}

/** 定位项目范围内的规范路径，个人配置和仓库外路径返回 null。 */
export async function scopedProjectPath(
  path: string,
  { root, personalDirectory }: ProjectConfigurationFileScope,
): Promise<string | null> {
  const canonical = await canonicalProjectPath(path)
  return canonical &&
    canonical !== root &&
    containsProjectPath(root, canonical) &&
    !containsProjectPath(personalDirectory, canonical)
    ? canonical
    : null
}
