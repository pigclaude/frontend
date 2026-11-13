// 负责把桌面界面挂到页面上：先接好 Pigcode 组件读取的原生桥，再按 Pigcode 全局样式、PigClaude 页面样式的顺序载入样式。
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@pigclaude/ui-primitives/styles/globals.css"
import { DesktopApp } from "./app"
import { AuthorizeWeb } from "./authorize-web"
import { installPigcodeNative } from "./lib/pigcode-native"
import { parseDevView } from "./models/dev-view"
import "./styles/pigclaude-tokens.css"
import "./styles/app.css"
import "./styles/screens.css"
import "./styles/signin.css"
import "./styles/recovery.css"
import "./styles/onboarding.css"
import "./styles/ui-controls.css"
import "./styles/combobox.css"
import "./styles/appearance-page.css"
import "./styles/fingerprint.css"
import "./styles/browser-profiles.css"
import "./styles/appearance.css"
import "./styles/shell.css"
import "./styles/permission-prompt.css"

if (installPigcodeNative() && window.pigclaude) {
  document.documentElement.dataset.shell = "electron"
  document.documentElement.dataset.platform = window.pigclaude.platform
}

if (parseDevView(window.location.search, import.meta.env.DEV)?.glass) {
  document.documentElement.dataset.glass = "true"
}

const root = document.getElementById("root")
const page = window.location.pathname.startsWith("/authorize") ? <AuthorizeWeb /> : <DesktopApp />
if (root) {
  createRoot(root).render(<StrictMode>{page}</StrictMode>)
}
