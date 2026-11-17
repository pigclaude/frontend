// 保留 Linux 安装内核的原始启动错误，使用独立配置且不改变沙箱参数。
import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

/** 从仍挂载的 AppImage 内核采集最小启动的退出码和 stderr。 */
export async function diagnoseLinuxBrowser(binary, directory, evidence) {
  let stderr = ""
  const child = spawn(
    binary,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--remote-debugging-port=0",
      "--user-data-dir=" + join(directory, "raw-browser-diagnostic"),
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  )
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-12000)
  })
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      resolve({ remainedRunning: true })
    }, 6000)
    child.once("error", (error) => {
      clearTimeout(timer)
      resolve({ error: String(error.message) })
    })
    child.once("exit", (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
  await writeFile(
    join(evidence, "pigbrowser-linux-startup.json"),
    JSON.stringify(
      {
        ...result,
        apparmor: (
          await readFile("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").catch(
            () => "",
          )
        ).trim(),
        stderr,
      },
      null,
      2,
    ) + "\n",
  )
}
