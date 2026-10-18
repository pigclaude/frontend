// 负责把桌面界面挂到页面上，并载入设计稿的样式。
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { DesktopApp } from "./app"
import { AuthorizeWeb } from "./authorize-web"
import { parseDevView } from "./models/dev-view"
import "./styles/tokens.css"
import "./styles/app.css"
import "./styles/screens.css"
import "./styles/ui-controls.css"
import "./styles/glass.css"
import "./styles/appearance.css"

if (window.pigclaude) {
  document.documentElement.dataset.shell = "electron"
  document.documentElement.dataset.platform = window.pigclaude.platform
  const glass = window.pigclaude.platform === "darwin" || window.pigclaude.platform === "win32"
  if (glass) document.documentElement.dataset.glass = "true"
}

if (parseDevView(window.location.search, import.meta.env.DEV)?.glass) {
  document.documentElement.dataset.glass = "true"
}

const root = document.getElementById("root")
const page = window.location.pathname.startsWith("/authorize") ? <AuthorizeWeb /> : <DesktopApp />
if (root) {
  createRoot(root).render(<StrictMode>{page}</StrictMode>)
}
