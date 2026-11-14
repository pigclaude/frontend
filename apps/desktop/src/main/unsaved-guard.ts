// 负责页面刷新前的未保存确认：页面有未保存的文件时会拦下卸载，主进程问用户保存、不保存还是取消。
// 关窗和退出在更早的确认里已经处理过未保存的文件，这里接住的是刷新。
import type { LeaveAnswer } from "./quit-confirmation"

/** 刷新确认用到的页面能力；Electron 的 WebContents 满足这个形状。 */
export type ReloadablePage = {
  on(event: "will-prevent-unload", listener: (event: { preventDefault(): void }) => void): unknown
  reload(): void
  isDestroyed(): boolean
}

/** 刷新确认的依赖：这个页面的未保存文件数、请它全部保存，以及同步向用户提问。 */
export type ReloadGuardOptions = {
  unsavedFiles: () => number
  saveFiles: () => Promise<boolean>
  ask: (unsavedFiles: number) => LeaveAnswer
}

/** 页面被未保存的文件拦下卸载时提问：不保存就放行，取消就留下，保存全部成功后再刷新。 */
export function guardReload(page: ReloadablePage, options: ReloadGuardOptions): void {
  page.on("will-prevent-unload", (event) => {
    const answer = options.ask(Math.max(1, options.unsavedFiles()))
    if (answer === "leave") {
      event.preventDefault()
      return
    }
    if (answer !== "save") return
    void options.saveFiles().then((saved) => {
      if (saved && !page.isDestroyed()) page.reload()
    })
  })
}
