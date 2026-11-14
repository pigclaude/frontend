// 负责保存「自动检查更新」开关：存在用户数据目录的一个小文件里，读不到时按开启处理。
import { readFileSync } from "node:fs"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

/** 读取自动检查开关；文件不存在、损坏或值不是布尔时返回 true。 */
export function readAutoCheck(file: string): boolean {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"))
    if (typeof value === "object" && value !== null && "autoCheck" in value) {
      return value.autoCheck !== false
    }
  } catch {
    // 第一次运行没有文件，或文件被改坏，都按默认开启。
  }
  return true
}

/** 写入自动检查开关；先写临时文件再改名，中途退出也不会留下半个文件。 */
export async function writeAutoCheck(file: string, value: boolean): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  await writeFile(temporary, `${JSON.stringify({ autoCheck: value })}\n`, "utf8")
  await rename(temporary, file)
}
