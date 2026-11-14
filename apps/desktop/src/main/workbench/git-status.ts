// 负责工作台的只读 Git 状态：列出项目里新增、修改、删除、改名和未跟踪的文件，供文件树装饰。
import type { WorkbenchChange } from "../../workbench-contract"
import { runWorkbenchGit } from "./git-command"
import { protectedWorkbenchPath, workbenchPathspec } from "./hidden-paths"

const maxChanges = 5000

/**
 * 返回项目内有改动的文件，路径相对项目目录，状态是 porcelain 的两位状态码。
 * 项目不在 Git 工作树里、Git 不可用或读取失败时返回 null，不改动索引。
 */
export async function workbenchStatus(root: string): Promise<WorkbenchChange[] | null> {
  try {
    const [inside, prefix = ""] = (
      await runWorkbenchGit(root, ["rev-parse", "--is-inside-work-tree", "--show-prefix"])
    ).split(/\r?\n/)
    if (inside !== "true") return null
    const output = await runWorkbenchGit(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ...workbenchPathspec(),
    ])
    return parseStatus(output, prefix).slice(0, maxChanges)
  } catch {
    return null
  }
}

function parseStatus(output: string, prefix: string): WorkbenchChange[] {
  const records = output.split("\0")
  const changes: WorkbenchChange[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? ""
    if (record.length < 4) continue
    const status = record.slice(0, 2)
    const path = record.slice(3)
    if (/[RC]/.test(status)) index += 1
    if (!path.startsWith(prefix)) continue
    const relative = path.slice(prefix.length)
    if (relative && !protectedWorkbenchPath(relative)) changes.push({ path: relative, status })
  }
  return changes
}
