// 提供项目 Diff、工作树与 GitHub PR 操作，所有目录和路径在主进程解析。
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { realpath } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { promisify } from "node:util"
import type { PullRequestInfo } from "@pigclaude/ui-contracts"
import type { WorkbenchWorktree } from "../../workbench-contract"
import { workbenchChildEnv } from "./child-env"
import { assertWorkbenchGit, gitExitCode, runWorkbenchGit } from "./git-command"
import { protectedWorkbenchPath, workbenchPathspec } from "./hidden-paths"
import { copyWorktreeIncludes } from "./worktree-includes"

const exec = promisify(execFile)
const noExternalDiff = ["--no-color", "--no-ext-diff", "--no-textconv"]
const maxPatchBytes = 2 * 1024 * 1024

/** 返回工作区与 HEAD 或指定检查点的文本差异，包含未跟踪文件。 */
export async function workbenchDiff(root: string, path?: string, base?: string): Promise<string> {
  await assertWorkbenchGit(root)
  if (
    path &&
    (path.startsWith("/") ||
      path.includes("\\") ||
      path.includes(":") ||
      path.split("/").some((part) => !part || part === ".." || part === "." || part === ".git"))
  ) {
    throw new Error("WORKBENCH_PATH_INVALID")
  }
  const pathspec = workbenchPathspec(path)
  const revision =
    base ??
    (await runWorkbenchGit(root, ["rev-parse", "--verify", "HEAD"])
      .then((output) => output.trim())
      .catch(() => null))
  const patch = await runWorkbenchGit(root, [
    "diff",
    ...noExternalDiff,
    "--relative",
    ...(revision ? [revision] : ["--cached"]),
    "--",
    ...pathspec,
  ])
  const untracked = await runWorkbenchGit(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...pathspec,
  ])
  const additions = untracked.split("\0").filter((file) => file && !protectedWorkbenchPath(file))
  if (additions.length > 100) throw new Error("WORKBENCH_DIFF_TOO_LARGE")
  let output = boundPatch(patch)
  for (const file of additions) output = boundPatch(output + (await untrackedDiff(root, file)))
  return output
}

function boundPatch(patch: string): string {
  if (Buffer.byteLength(patch) > maxPatchBytes) throw new Error("WORKBENCH_DIFF_TOO_LARGE")
  return patch
}

async function untrackedDiff(root: string, file: string): Promise<string> {
  try {
    return await runWorkbenchGit(root, [
      "diff",
      ...noExternalDiff,
      "--no-index",
      "--",
      "/dev/null",
      file,
    ])
  } catch (error: unknown) {
    if (
      gitExitCode(error) !== 1 ||
      typeof error !== "object" ||
      error === null ||
      !("stdout" in error) ||
      typeof error.stdout !== "string"
    )
      throw error
    return error.stdout
  }
}

/** 读取 Git 已登记的工作树及分支；支持路径和分支包含空格。 */
export async function listWorkbenchWorktrees(root: string): Promise<WorkbenchWorktree[]> {
  const output = await runWorkbenchGit(root, ["worktree", "list", "--porcelain", "-z"]).catch(
    () => "",
  )
  return output.split("\0\0").flatMap((record) => {
    const fields = record.split("\0")
    const path = fields.find((field) => field.startsWith("worktree "))?.slice(9)
    const branch = fields.find((field) => field.startsWith("branch "))?.slice(7) ?? null
    if (!path || fields.includes("bare")) return []
    return [{ path, branch: branch?.replace(/^refs\/heads\//, "") ?? null }]
  })
}

/**
 * 在主项目旁边创建独立分支的工作树，保留现有工作区的索引和分支。从 baseRef（本地或远端分支的完整
 * ref）或 HEAD 起步，并按 .worktreeinclude 带上本机文件；任何一步失败都不留下目录和新分支。
 */
export async function createWorkbenchWorktree(
  root: string,
  baseRef?: string,
): Promise<WorkbenchWorktree> {
  await assertWorkbenchGit(root)
  const first = (await listWorkbenchWorktrees(root))[0]
  if (!first) throw new Error("WORKBENCH_NOT_GIT")
  const gitRoot = await realpath(first.path)
  const checkout = await realpath(
    (await runWorkbenchGit(root, ["rev-parse", "--show-toplevel"])).trim(),
  )
  const commit = await worktreeBase(root, baseRef)
  const suffix = randomUUID().slice(0, 8)
  const path = join(dirname(gitRoot), `${basename(gitRoot)}-worktree-${suffix}`)
  const branch = `pigclaude/worktree-${suffix}`
  await runWorkbenchGit(root, ["worktree", "add", "-b", branch, "--", path, commit])
  try {
    await copyWorktreeIncludes(checkout, path)
  } catch (error: unknown) {
    await runWorkbenchGit(gitRoot, ["worktree", "remove", "--force", "--", path]).catch(
      () => undefined,
    )
    await runWorkbenchGit(gitRoot, ["branch", "-D", branch]).catch(() => undefined)
    throw error
  }
  return { path, branch }
}

async function worktreeBase(root: string, baseRef?: string): Promise<string> {
  if (baseRef !== undefined && !/^refs\/(heads|remotes)\/[^\0\r\n]+$/.test(baseRef))
    throw new Error("WORKBENCH_WORKTREE_BASE_INVALID")
  try {
    if (baseRef !== undefined) await runWorkbenchGit(root, ["check-ref-format", baseRef])
    const output = await runWorkbenchGit(root, [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${baseRef ?? "HEAD"}^{commit}`,
    ])
    return output.trim()
  } catch {
    throw new Error("WORKBENCH_WORKTREE_BASE_INVALID")
  }
}

/** 移除同仓库的独立工作树；Git 拒绝移除有本地改动的目录。 */
export async function removeWorkbenchWorktree(root: string, path: string): Promise<void> {
  const target = await realpath(path)
  const records = await listWorkbenchWorktrees(root)
  const first = records[0]?.path
  const main = first ? await realpath(first) : null
  if (!main || target === main) throw new Error("WORKBENCH_PATH_INVALID")
  const candidates = await Promise.all(
    records.map((record) => realpath(record.path).catch(() => null)),
  )
  if (!candidates.includes(target)) {
    throw new Error("WORKBENCH_PATH_INVALID")
  }
  await runWorkbenchGit(main, ["worktree", "remove", "--", target])
}

async function runGh(root: string, args: string[]): Promise<string> {
  try {
    return (
      await exec("gh", args, {
        cwd: root,
        env: { ...workbenchChildEnv(), GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
        maxBuffer: 512 * 1024,
        timeout: 20_000,
        windowsHide: true,
      })
    ).stdout
  } catch (error: unknown) {
    if (gitExitCode(error) === "ENOENT") throw new Error("GH_NOT_AVAILABLE")
    const stderr =
      error && typeof error === "object" && "stderr" in error ? String(error.stderr) : ""
    if (/no pull requests? found/i.test(stderr)) return ""
    if (/gh auth login|not logged|authentication required/i.test(stderr))
      throw new Error("GH_NOT_AUTHENTICATED")
    if (/no (git )?remotes?|no git remote/i.test(stderr)) throw new Error("GIT_NO_REMOTE")
    throw new Error("WORKBENCH_PR_FAILED")
  }
}

/** 查询当前分支的 PR，只回传界面需要的公开信息。 */
export async function readWorkbenchPullRequest(root: string): Promise<PullRequestInfo | null> {
  if (!(await runWorkbenchGit(root, ["remote"])).trim()) throw new Error("GIT_NO_REMOTE")
  const output = await runGh(root, [
    "pr",
    "view",
    "--json",
    "number,url,state,title,headRefName,baseRefName",
  ])
  if (!output) return null
  const value: unknown = JSON.parse(output)
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const { number, url, state, title, headRefName, baseRefName } = record
  if (
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number < 1 ||
    typeof url !== "string" ||
    !url.startsWith("https://") ||
    (state !== "OPEN" && state !== "CLOSED" && state !== "MERGED") ||
    typeof title !== "string" ||
    typeof headRefName !== "string" ||
    typeof baseRefName !== "string"
  ) {
    throw new Error("WORKBENCH_PR_FAILED")
  }
  return { number, url, state, title, headRefName, baseRefName }
}

/** 用户提交表单后为已有远端分支建 PR；显式指定 head 以避免隐式推送。 */
export async function createWorkbenchPullRequest(
  root: string,
  input: { title: string; body?: string; base?: string },
): Promise<void> {
  const branch = (await runWorkbenchGit(root, ["symbolic-ref", "--short", "HEAD"])).trim()
  if (!branch) throw new Error("WORKBENCH_PR_FAILED")
  await runGh(root, [
    "pr",
    "create",
    "--head",
    branch,
    "--title",
    input.title,
    "--body",
    input.body ?? "",
    ...(input.base ? ["--base", input.base] : []),
  ])
}
