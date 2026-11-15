// 只在通过 Chromium 沙箱检查的插件页面转交一个消息端口，不向页面暴露 Electron IPC。
import { ipcRenderer } from "electron"

declare const window: {
  location: { protocol: string; pathname: string; origin: string }
  postMessage(message: string, origin: string, transfer: unknown[]): void
}

ipcRenderer.once("pigclaude:plugin-sandbox-attach", (event) => {
  const port = event.ports[0]
  if (!port) return
  const sandboxed =
    process.sandboxed === true &&
    window.location.protocol === "pigclaude-plugin:" &&
    window.location.pathname === "/runtime/index.html"
  port.postMessage({ type: "attestation", sandboxed })
  if (sandboxed) window.postMessage("pigclaude-plugin-port", window.location.origin, [port])
  else port.close()
})
