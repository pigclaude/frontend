// 为异常退出测试启动一个持有真实 Xray 的独立合成桌面进程。

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { readFile, rename, writeFile } from "node:fs/promises"
import { it } from "vitest"
import { createXrayRuntimeStarter } from "./xray-runtime"

const output = process.env["PIGCLAUDE_TEST_XRAY_READY_FILE"]
const binary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]
const outcome = process.env["PIGCLAUDE_TEST_XRAY_CLOSE_FILE"]
const targetFile = process.env["PIGCLAUDE_TEST_XRAY_KILLED_FILE"]

it.skipIf(!output || !binary)(
  "等待外部测试终止当前合成宿主",
  async () => {
    if (!output || !binary) throw new Error("缺少合成测试参数")
    const watchdogs: ChildProcess[] = []
    const capture = ((command: string, args: string[], options: SpawnOptions) => {
      const child = spawn(command, args, options)
      watchdogs.push(child)
      return child
    }) as typeof spawn
    const start = createXrayRuntimeStarter({
      hostArch: process.arch,
      binaryPath: binary,
      spawn: capture,
    })
    const runtime = await start({ upstreamProxyUrl: "http://127.0.0.1:9" })
    const initialWatchdogCount = watchdogs.length
    await writeFile(`${output}.tmp`, runtime.url)
    await rename(`${output}.tmp`, output)
    if (outcome !== undefined) {
      if (targetFile === undefined) throw new Error("缺少本次终止的守护进程标记")
      let targetPid = 0
      while (targetPid <= 0) {
        try {
          targetPid = Number(await readFile(targetFile, "utf8"))
        } catch {
          // 等待测试指定本次将终止的守护进程。
        }
        if (!Number.isInteger(targetPid) || targetPid <= 0) {
          targetPid = 0
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }
      while (true) {
        try {
          const current = watchdogs.at(-1)
          if (watchdogs.length > initialWatchdogCount && current?.pid !== targetPid) {
            runtime.assertRunning?.()
            break
          }
        } catch {
          // 新守护进程仍在启动，继续等待实际恢复。
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      await writeFile(`${outcome}.tmp`, "restored")
      await rename(`${outcome}.tmp`, outcome)
    }
    await new Promise<void>(() => undefined)
  },
  30_000,
)
