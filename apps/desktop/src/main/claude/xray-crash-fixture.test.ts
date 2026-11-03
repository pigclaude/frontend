// 为异常退出测试启动一个持有真实 Xray 的独立合成桌面进程。

import { writeFile } from "node:fs/promises"
import { it } from "vitest"
import { createXrayRuntimeStarter } from "./xray-runtime"

const output = process.env["PIGCLAUDE_TEST_XRAY_READY_FILE"]
const binary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]
const outcome = process.env["PIGCLAUDE_TEST_XRAY_CLOSE_FILE"]

it.skipIf(!output || !binary)(
  "等待外部测试终止当前合成宿主",
  async () => {
    if (!output || !binary) throw new Error("缺少合成测试参数")
    const start = createXrayRuntimeStarter({ hostArch: process.arch, binaryPath: binary })
    const runtime = await start({ upstreamProxyUrl: "http://127.0.0.1:9" })
    await writeFile(output, runtime.url)
    if (outcome !== undefined) {
      const timer = setInterval(() => {
        try {
          runtime.assertRunning?.()
        } catch {
          clearInterval(timer)
          void runtime.close().then(
            () => writeFile(outcome, "resolved"),
            () => writeFile(outcome, "rejected"),
          )
        }
      }, 30)
    }
    await new Promise<void>(() => undefined)
  },
  30_000,
)
