// 负责用系统托盘唤回主窗口，并把退出交给应用的统一退出流程。

import { app, Menu, nativeImage, Tray } from "electron"

// 从 Dock 图标的 snout 标记生成的 20px 透明 PNG。macOS 使用模板图自动适配菜单栏。
const trayIcon =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAACpklEQVR42u1UQUhUURQ9970/jvNnHB3HGRJJKHfpInIRbYKCVpKLYlzUQgVJogypIGwz/9MiyzJEjKSCrFbfVbVoFVqbiihpYQtXQpDY2CgzjPPnz7x3WziKii6CdnXhbe499/DOvec94J8L2p5gZoI1LdGcYkzu0pUAMBsjYFqTbetd2TmZFH96o+09xuYC2bb+dmE0ur86erbE6nhRa5PBAFiX5RAzhE8aniTxYTGXeUb2+XlOsiCb9IbkdbKf/eOHQsGq14FAKL6STacBpJjZByBYBrsMzhNRbY0Zjhc8r5TNZ07HhntfrnMQJ5MCtsW568/3kDS+CkbBLbhdNeb822V33xkS+B652TUFANmBpy3MfHQu7T5silS2VPp8D0j6Wt1C7nD1YNcXJBwhPi8sSAKxp9Qls8KMZVdz7ZGh7jcIN/sMISdY8+31sSit+6vC0bG9YX9j5FbnTHo128asPGZYBDASgGitr1drcvjkcubXbHy4Z4YTjkRmmUqqtEqMfHk0xEARhbzyqyJxkkXDcO9SPr/6isEnuG/ETx0dSsCyuOwgHxMXAAAHZhmZCIPWNrJxWAMMhvQxLDDWknkABmrDBAACliXLhamQGT6YvjbeSLatl4yM4ZcVQQaqOOFITjgSRAEEgoZneJKIeK5vxF9ZEWgj0Huyu13HcaQAoAFAauOe1qwqjJCzcvVJU2yoJ+up4ikhuJcmOxRNdigAVia71BkfPDf3Y+BxrKGqbsI0Q3VEuAEAsbFZ2mKb1OXx9nCw+gUByHnuR4AXATLWbQPA1cyuIESJxJHqUI1cXkldqr3TM7phm+3GXrjyqCUSMC8WtTpWUspkMAikyjABgAwhPEHyU66Qvx+/2/Nus7H/+tPbEcDJpME7fBxbcE55Uf/jN4cUS3eAs2kwAAAAAElFTkSuQmCC"

/** 就绪后创建托盘和基础菜单；没有可用托盘时保留原来的关闭窗口行为。 */
export function createDesktopTray(openWindow: () => void): Tray | null {
  let tray: Tray | null = null
  try {
    const icon = nativeImage.createFromDataURL(trayIcon)
    if (process.platform === "darwin") icon.setTemplateImage(true)
    tray = new Tray(icon)
    tray.setToolTip("PigClaude")
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { id: "open-window", label: "打开窗口", click: openWindow },
        { id: "quit", label: "退出", click: () => app.quit() },
      ]),
    )
    tray.on("click", openWindow)
    return tray
  } catch {
    tray?.destroy()
    return null
  }
}
