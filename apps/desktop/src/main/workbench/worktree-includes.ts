// 负责把 .worktreeinclude 列出的、被 Git 忽略的本机文件复制进新的 worktree，例如本机配置。
import { constants } from "node:fs"
import { copyFile, lstat, mkdir, realpath } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, sep } from "node:path"
import { gitExitCode, runWorkbenchGit } from "./git-command"

const includeFile = ".worktreeinclude"
const maxIncludedFiles = 5000

/**
 * 只复制同时满足三点的文件：匹配 source 根目录的 .worktreeinclude、被 Git 忽略、是项目里的普通文件。
 * 符号链接和 `.git` 里的路径跳过，目标里已有的文件不覆盖。没有 .worktreeinclude 时什么都不做。
 */
export async function copyWorktreeIncludes(source: string, target: string): Promise<void> {
  const include = await lstat(join(source, includeFile)).catch(() => null)
  if (!include?.isFile()) return
  const listed = await runWorkbenchGit(source, [
    "ls-files",
    "-z",
    "--others",
    "--ignored",
    `--exclude-from=${includeFile}`,
  ])
  const candidates = listed.split("\0").filter(Boolean)
  if (candidates.length > maxIncludedFiles) throw new Error("WORKBENCH_WORKTREE_INCLUDE_TOO_LARGE")
  for (const name of await ignoredByGit(source, candidates)) {
    if (name.split("/").some((part) => part.toLowerCase() === ".git")) continue
    const from = join(source, ...name.split("/"))
    if (!(await lstat(from)).isFile() || !inside(source, await realpath(from))) continue
    await copyInto(target, from, join(target, ...name.split("/")))
  }
}

async function ignoredByGit(source: string, names: readonly string[]): Promise<string[]> {
  if (names.length === 0) return []
  const output = await runWorkbenchGit(
    source,
    ["check-ignore", "-z", "--stdin"],
    {},
    names.map((name) => name + "\0").join(""),
  ).catch((error: unknown) => {
    if (gitExitCode(error) === 1) return ""
    throw error
  })
  return output.split("\0").filter(Boolean)
}

async function copyInto(root: string, from: string, to: string): Promise<void> {
  // 建目录前确认最近的已有上级目录没有经符号链接通到 worktree 外。
  let existing = dirname(to)
  while (existing !== root) {
    const info = await lstat(existing).catch(() => null)
    if (info) {
      if (!info.isDirectory() || !inside(root, await realpath(existing))) return
      break
    }
    existing = dirname(existing)
  }
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to, constants.COPYFILE_EXCL).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
  })
}

function inside(root: string, path: string): boolean {
  const nested = relative(root, path)
  return nested === "" || (!isAbsolute(nested) && nested !== ".." && !nested.startsWith(".." + sep))
}
