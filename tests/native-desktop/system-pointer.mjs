// 使用运行器桌面的原生输入工具验证由 Electron 或窗口管理器绘制的部分。
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

const run = promisify(execFile)
const windows = fileURLToPath(new URL("./windows-pointer.ps1", import.meta.url))

/** 发送窗口外的原生鼠标或键盘操作，并等待系统工具返回。 */
export async function systemInput(action, ...values) {
  const args = values.map((value) =>
    typeof value === "number" ? String(Math.round(value)) : value,
  )
  const [x, y, toX, toY] = args
  if (process.platform === "win32") {
    await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-File", windows, action, ...args],
      { timeout: 12_000 },
    )
    return
  }
  if (action === "capture") {
    await run("import", ["-window", "root", x], { timeout: 12_000 })
    return
  }
  const commands = {
    click: ["mousemove", x, y, "click", "1"],
    drag: [
      "mousemove",
      x,
      y,
      "mousedown",
      "1",
      "sleep",
      "0.15",
      "mousemove",
      toX,
      toY,
      "sleep",
      "0.2",
      "mouseup",
      "1",
    ],
    key: ["key", x],
    back: ["mousemove", x, y, "click", "8"],
    forward: ["mousemove", x, y, "click", "9"],
  }
  await run("xdotool", commands[action], { timeout: 12_000 })
}
