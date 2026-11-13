// 用项目内的隐藏 Git 引用保存与恢复检查点，保留用户的暂存区。
import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"
import type { WorkbenchCheckpoint } from "../../workbench-contract"
import { assertWorkbenchGit, runWorkbenchGit } from "./git-command"
import { protectedWorkbenchPath, workbenchPathspec } from "./git-workspace"

const prefix = "refs/pigclaude/checkpoints/"
const checkpointId = /^(manual|baseline|final)-[0-9a-f-]{36}$/

function ref(scope: string, id: string): string {
  if (!checkpointId.test(id)) throw new Error("WORKBENCH_CHECKPOINT_INVALID")
  return scope + id
}

async function scopeFor(root: string): Promise<{ gitRoot: string; scope: string }> {
  const gitRoot = (await runWorkbenchGit(root, ["rev-parse", "--show-toplevel"])).trim()
  const canonical = await realpath(root)
  const key = process.platform === "win32" ? canonical.toLowerCase() : canonical
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 20)
  return { gitRoot, scope: prefix + digest + "/" }
}

/** 从持久化 Git 引用读取检查点及建立时间，按创建时间排序。 */
export async function listWorkbenchCheckpoints(root: string): Promise<WorkbenchCheckpoint[]> {
  const { scope } = await scopeFor(root)
  const format = "%(refname:strip=4)%00%(committerdate:iso-strict)"
  const output = await runWorkbenchGit(root, [
    "for-each-ref",
    "--sort=committerdate",
    "--format=" + format,
    scope,
  ])
  return output
    .trim()
    .split("\n")
    .flatMap((record): WorkbenchCheckpoint[] => {
      const [id, createdAt] = record.split("\0")
      if (!id || !createdAt || !checkpointId.test(id)) return []
      const phase = id.startsWith("baseline-")
        ? "baseline"
        : id.startsWith("final-")
          ? "final"
          : "manual"
      return [{ id, createdAt, phase, label: null, runId: null }]
    })
}

/** 解析选择的检查点，保证 Diff 只接受本应用记录的完整 Git 提交。 */
export async function resolveWorkbenchCheckpoint(root: string, id: string): Promise<string> {
  const { scope } = await scopeFor(root)
  return (
    await runWorkbenchGit(root, ["rev-parse", "--verify", ref(scope, id) + "^{commit}"])
  ).trim()
}

/** 用独立索引快照工作区，避免改变当前分支、索引或提交历史。 */
export async function captureWorkbenchCheckpoint(
  root: string,
  phase: WorkbenchCheckpoint["phase"] = "manual",
): Promise<string> {
  await assertWorkbenchGit(root)
  const { gitRoot, scope } = await scopeFor(root)
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-checkpoint-"))
  const env = {
    GIT_INDEX_FILE: join(directory, "index"),
    GIT_AUTHOR_NAME: "PigClaude",
    GIT_AUTHOR_EMAIL: "checkpoint@pigclaude.local",
    GIT_COMMITTER_NAME: "PigClaude",
    GIT_COMMITTER_EMAIL: "checkpoint@pigclaude.local",
  }
  const id = `${phase}-${randomUUID()}`
  try {
    const parent = await runWorkbenchGit(gitRoot, ["rev-parse", "--verify", "HEAD"])
      .then((output) => output.trim())
      .catch(() => "")
    if (parent) await runWorkbenchGit(gitRoot, ["read-tree", parent], env)
    await runWorkbenchGit(
      root,
      ["-c", "core.autocrlf=false", "add", "-A", "--", ...workbenchPathspec()],
      env,
    )
    const tree = (await runWorkbenchGit(gitRoot, ["write-tree"], env)).trim()
    const sha = (
      await runWorkbenchGit(
        gitRoot,
        ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", "PigClaude checkpoint"],
        env,
      )
    ).trim()
    await runWorkbenchGit(gitRoot, ["update-ref", ref(scope, id), sha])
    return id
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** 恢复检查点中的项目文件；恢复前保存一份当前工作区的检查点。 */
export async function restoreWorkbenchCheckpoint(root: string, id: string): Promise<void> {
  const { gitRoot } = await scopeFor(root)
  const commit = await resolveWorkbenchCheckpoint(root, id)
  await captureWorkbenchCheckpoint(root)
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-restore-"))
  const env = { GIT_INDEX_FILE: join(directory, "index") }
  try {
    const project = relative(gitRoot, root).split(sep).join("/") || "."
    const snapshot = await runWorkbenchGit(gitRoot, [
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      commit,
      "--",
      project,
    ])
    const untracked = await runWorkbenchGit(root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...workbenchPathspec(),
    ])
    const selected = new Set(
      snapshot.split("\0").filter((path) => path && !protectedWorkbenchPath(path)),
    )
    const current = await runWorkbenchGit(root, ["ls-files", "-z", "--", ...workbenchPathspec()])
    await runWorkbenchGit(gitRoot, ["read-tree", commit], env)
    const omitted = current
      .split("\0")
      .filter((path) => path && !selected.has(project === "." ? path : project + "/" + path))
    if (omitted.length > 0)
      await runWorkbenchGit(root, ["update-index", "--add", "--remove", "--", ...omitted], env)
    if (selected.size > 0 || omitted.length > 0)
      await runWorkbenchGit(
        root,
        [
          "-c",
          "core.autocrlf=false",
          "restore",
          "--source=" + commit,
          "--worktree",
          "--",
          ...workbenchPathspec(),
        ],
        env,
      )
    const additions = untracked
      .split("\0")
      .filter(
        (path) =>
          path &&
          !protectedWorkbenchPath(path) &&
          !selected.has(project === "." ? path : project + "/" + path),
      )
    if (additions.length > 0) {
      await runWorkbenchGit(root, [
        "clean",
        "-f",
        "--",
        ...additions.map((path) => ":(literal)" + path),
      ])
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
