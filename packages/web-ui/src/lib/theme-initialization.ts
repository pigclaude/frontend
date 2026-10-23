// 负责提供浏览器和 Node 构建配置均可读取的无注释首帧主题脚本。
import { createAccentEngine } from "@pigclaude/web-ui/lib/accent-engine"
import { ACCENT_PRESETS } from "@pigclaude/web-ui/lib/accent-presets"

/** 在 React 启动前严格重算并校验缓存，不允许任意或错配 CSS 注入。 */
export const themeInitializationScript =
  'try{if(localStorage.getItem("pigclaude-theme")==="light"){document.documentElement.dataset.theme="light"}else{delete document.documentElement.dataset.theme}}catch{}' +
  `;try{const engine=(${createAccentEngine.toString()})();const cached=engine.parse(localStorage.getItem("pigclaude-accent"),${JSON.stringify(ACCENT_PRESETS)});if(cached){let style=document.getElementById("pigclaude-accent");if(!style){style=document.createElement("style");style.id="pigclaude-accent";document.head.appendChild(style)}style.textContent=cached.css}}catch{}`
