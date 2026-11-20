// 在专用验收机改变系统时区，观察公开调度服务自动更新每日任务。
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as wait } from "node:timers/promises"
import { promisify } from "node:util"
import { ScheduledTaskService } from "../../apps/desktop/src/main/scheduled-tasks/service"

const run = promisify(execFile)
const windows = process.platform === "win32"
const mac = process.platform === "darwin"
const saved = (
  await (windows
    ? run("tzutil.exe", ["/g"])
    : mac
      ? run("sudo", ["-n", "systemsetup", "-gettimezone"])
      : run("timedatectl", ["show", "-p", "Timezone", "--value"]))
).stdout
  .trim()
  .replace(/^Time Zone: /, "")
assert.match(saved, /^(UTC|Etc\/UTC|GMT)$/)
assert.equal(process.env.TZ, undefined)
const setZone = (zone: string) =>
  windows
    ? run("tzutil.exe", ["/s", zone])
    : mac
      ? run("sudo", ["-n", "systemsetup", "-settimezone", zone])
      : run("sudo", ["-n", "timedatectl", "set-timezone", zone])

const dir = await mkdtemp(join(tmpdir(), "pigclaude-qa-local-zone-"))
const tasks = new ScheduledTaskService({
  filePath: join(dir, "scheduled-tasks.json"),
  run: async () => ({ status: "skipped", reason: "FIXTURE" }),
  reportError: (error) => console.error("scheduler error", error),
})
let switched = false
try {
  await tasks.start()
  const date = new Date(Date.now() + 3 * 3600_000)
  const time =
    String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0")
  const task = await tasks.create({
    projectPath: dir,
    prompt: "合成任务",
    rule: { kind: "daily", time },
    endsAt: null,
    enabled: true,
    model: null,
    permissionMode: "default",
    accountId: null,
  })
  assert.ok(task.nextRunAt)
  const expected = new Date(Date.parse(task.nextRunAt) + 7 * 3600_000).toISOString()
  await setZone(windows ? "US Mountain Standard Time" : "America/Phoenix")
  switched = true
  let observed: string | null | undefined
  for (let i = 0; i < 37; i++) {
    observed = (await tasks.list()).find(({ id }) => id === task.id)?.nextRunAt
    if (observed === expected) break
    await wait(2000)
  }
  console.log(
    JSON.stringify({
      platform: process.platform,
      node: process.versions.node,
      initialNextRunAt: task.nextRunAt,
      expectedNextRunAt: expected,
      observedNextRunAt: observed,
    }),
  )
  assert.equal(observed, expected)
  assert.equal((await tasks.runs(task.id, 0, 10)).total, 0)
} finally {
  try {
    if (switched) await setZone(saved)
  } finally {
    await tasks.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}
