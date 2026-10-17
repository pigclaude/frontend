// 负责把桌面界面挂到页面上，并载入设计稿的样式。
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { DesktopApp } from "./app"
import { AuthorizeWeb } from "./authorize-web"
import "./styles/tokens.css"
import "./styles/app.css"
import "./styles/screens.css"

if (window.pigclaude) document.documentElement.dataset.shell = "electron"

const root = document.getElementById("root")
const page = window.location.pathname.startsWith("/authorize") ? <AuthorizeWeb /> : <DesktopApp />
if (root) {
  createRoot(root).render(<StrictMode>{page}</StrictMode>)
}
