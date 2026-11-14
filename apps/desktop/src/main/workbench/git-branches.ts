// 负责新会话草稿的分支：读取项目目录的当前分支和分支列表，切换到已有分支或从 HEAD 新建分支。
import type { WorkbenchBranches } from "../../workbench-contract"
import { runWorkbenchGit } from "./git-command"

const maxBranches = 2000
const englishGit = { LC_ALL: "C", LANGUAGE: "C" }

/** 读取分支和 HEAD，不扫描工作区文件；普通目录或 Git 不可用时返回 null。 */
export async function workbenchBranches(root: string): Promise<WorkbenchBranches | null> {
  const inside = await runWorkbenchGit(root, ["rev-parse", "--is-inside-work-tree"]).catch(() => "")
  if (inside.trim() !== "true") return null
  const [branch, head, refs] = await Promise.all([
    runWorkbenchGit(root, ["symbolic-ref", "-q", "HEAD"]).catch(() => ""),
    runWorkbenchGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => ""),
    runWorkbenchGit(root, [
      "for-each-ref",
      "--format=%(refname)%00%(symref)",
      "refs/heads",
      "refs/remotes",
    ]),
  ])
  const localBranches: string[] = []
  const remoteBranches: string[] = []
  for (const line of refs.split(/\r?\n/)) {
    const [ref, symbolicTarget] = line.split("\0")
    if (!ref || symbolicTarget) continue
    if (ref.startsWith("refs/heads/") && localBranches.length < maxBranches)
      localBranches.push(ref.slice("refs/heads/".length))
    if (ref.startsWith("refs/remotes/") && remoteBranches.length < maxBranches)
      remoteBranches.push(ref.slice("refs/remotes/".length))
  }
  return {
    currentBranch: branch.trim().replace(/^refs\/heads\//, "") || null,
    head: head.trim() || null,
    localBranches,
    remoteBranches,
  }
}

/**
 * 切换到已有的本地分支，或从 HEAD 新建分支并切过去。会覆盖未提交改动或未跟踪文件时 Git 拒绝切换，
 * 改动原样留下；失败只抛出 WORKBENCH_BRANCH_* 错误码。
 */
export async function switchWorkbenchBranch(
  root: string,
  branch: string,
  create: boolean,
): Promise<WorkbenchBranches | null> {
  await assertBranchName(root, branch)
  try {
    await runWorkbenchGit(
      root,
      [
        "switch",
        "--no-guess",
        "--no-overwrite-ignore",
        ...(create ? ["--create", branch] : ["--", branch]),
      ],
      englishGit,
    )
  } catch (error: unknown) {
    const stderr =
      error && typeof error === "object" && "stderr" in error ? String(error.stderr) : ""
    if (/would be overwritten/i.test(stderr)) throw new Error("WORKBENCH_BRANCH_CONFLICT")
    if (/already exists/i.test(stderr)) throw new Error("WORKBENCH_BRANCH_EXISTS")
    throw new Error("WORKBENCH_BRANCH_FAILED")
  }
  return workbenchBranches(root)
}

async function assertBranchName(root: string, branch: string): Promise<void> {
  if (!branch || branch.startsWith("-") || /[\0\r\n]/.test(branch) || branch.includes("@{"))
    throw new Error("WORKBENCH_BRANCH_INVALID")
  await runWorkbenchGit(root, ["check-ref-format", "--branch", branch]).catch(() => {
    throw new Error("WORKBENCH_BRANCH_INVALID")
  })
}
