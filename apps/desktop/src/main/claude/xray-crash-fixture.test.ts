// 为异常退出测试启动一个持有真实 Xray 的独立合成桌面进程。

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { rename, writeFile } from "node:fs/promises"
import { it } from "vitest"
import { createXrayRuntimeStarter } from "./xray-runtime"

const output = process.env["PIGCLAUDE_TEST_XRAY_READY_FILE"]
const binary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]
const outcome = process.env["PIGCLAUDE_TEST_XRAY_CLOSE_FILE"]

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
    await writeFile(`${output}.tmp`, runtime.url)
    await rename(`${output}.tmp`, output)
    if (outcome !== undefined) {
      const timer = setInterval(() => {
        try {
          if (watchdogs.length < 2) return
          runtime.assertRunning?.()
          clearInterval(timer)
          void writeFile(`${outcome}.tmp`, "restored").then(() => rename(`${outcome}.tmp`, outcome))
        } catch {
          // 新守护进程仍在启动，继续等待实际恢复。
        }
      }, 10)
    }
    await new Promise<void>(() => undefined)
  },
  30_000,
)
