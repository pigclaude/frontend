// 负责用临时仓库验证工作台的只读 Git 状态：路径相对项目目录，排除 Claude Code 配置，普通目录不报错。
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { workbenchStatus } from "./git-status"

const exec = promisify(execFile)
let directory: string

const git = (cwd: string, ...args: string[]) =>
  exec(
    "git",
    ["-c", "user.name=Workbench QA", "-c", "user.email=workbench@example.test", ...args],
    { cwd },
  )

async function repository(path: string, files: Record<string, string>): Promise<void> {
  await mkdir(path, { recursive: true })
  await git(path, "init", "-q")
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(path, name, ".."), { recursive: true })
    await writeFile(join(path, name), text)
  }
  await git(path, "add", "-A")
  await git(path, "commit", "-qm", "initial")
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-workbench-status-")))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("workbench git status", () => {
  it("lists added, modified, deleted, renamed and untracked files but no Claude settings", async () => {
    const root = join(directory, "project")
    await repository(root, { "a.txt": "a\n", "b.txt": "b\n", "old.txt": "old\n", "c.txt": "c\n" })
    await writeFile(join(root, "a.txt"), "changed\n")
    await rm(join(root, "b.txt"))
    await git(root, "mv", "old.txt", "new.txt")
    await writeFile(join(root, "staged.txt"), "staged\n")
    await git(root, "add", "staged.txt")
    await mkdir(join(root, "src", "deep"), { recursive: true })
    await writeFile(join(root, "src", "deep", "fresh.ts"), "export {}\n")
    await mkdir(join(root, ".claude"))
    await writeFile(join(root, ".claude", "settings.local.json"), "{}\n")

    const changes = await workbenchStatus(root)

    expect(changes?.sort((left, right) => left.path.localeCompare(right.path))).toEqual([
      { path: "a.txt", status: " M" },
      { path: "b.txt", status: " D" },
      { path: "new.txt", status: "R " },
      { path: "src/deep/fresh.ts", status: "??" },
      { path: "staged.txt", status: "A " },
    ])
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("changed\n")
  })

  it("reports paths relative to a project inside a larger repository", async () => {
    await repository(directory, { "outside.txt": "o\n", "apps/web/inside.txt": "i\n" })
    await writeFile(join(directory, "outside.txt"), "changed\n")
    await writeFile(join(directory, "apps", "web", "inside.txt"), "changed\n")
    await writeFile(join(directory, "apps", "web", "new.txt"), "new\n")

    const changes = await workbenchStatus(join(directory, "apps", "web"))

    expect(changes?.sort((left, right) => left.path.localeCompare(right.path))).toEqual([
      { path: "inside.txt", status: " M" },
      { path: "new.txt", status: "??" },
    ])
  })

  it("returns nothing for a folder that is not a Git work tree", async () => {
    await writeFile(join(directory, "notes.txt"), "plain\n")

    await expect(workbenchStatus(directory)).resolves.toBeNull()
  })
})
