// 在本机数据目录内以私有权限原子替换文件。
import { randomUUID } from "node:crypto"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

/** 临时文件仅供所属用户读写；检查通过后一次替换完整文件。 */
export async function writePrivateFile(
  path: string,
  contents: string,
  beforePublish?: () => void,
): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx", mode: 0o600 })
    beforePublish?.()
    await rename(temporary, path)
  } catch (error: unknown) {
    await rm(temporary, { force: true })
    throw error
  }
}
