// 向 renderer 暴露显式的工作台命令，并按资源 ID 转发主进程事件。
import { ipcRenderer } from "electron"
import type { WorkbenchBridge, WorkbenchEvent } from "../workbench-contract"

/** 构造工作台桥，保证渲染进程无法选择任意 IPC 频道。 */
export function workbenchBridge(): WorkbenchBridge {
  const invoke = (name: string, ...args: unknown[]) =>
    ipcRenderer.invoke("pigclaude:workbench-" + name, ...args)
  return {
    list: (root, path) => invoke("list", root, path),
    search: (root, query) => invoke("search", root, query),
    read: (root, path) => invoke("read", root, path),
    save: (root, path, text, mtime) => invoke("save", root, path, text, mtime),
    diff: (root, path, checkpoint) => invoke("diff", root, path, checkpoint),
    worktrees: (root) => invoke("worktrees", root),
    createWorktree: (root) => invoke("worktree-create", root),
    removeWorktree: (root, path) => invoke("worktree-remove", root, path),
    checkpoints: (root) => invoke("checkpoints", root),
    capture: (root) => invoke("checkpoint-create", root),
    restore: (root, id) => invoke("checkpoint-restore", root, id),
    pullRequest: (root) => invoke("pr", root),
    createPullRequest: (root, input) => invoke("pr-create", root, input),
    terminalOpen: (root, id) => invoke("terminal-open", root, id),
    terminalWrite: (id, data) => invoke("terminal-write", id, data),
    terminalResize: (id, cols, rows) => invoke("terminal-resize", id, cols, rows),
    terminalClose: (id) => invoke("terminal-close", id),
    browserNavigate: (id, url) => invoke("browser-navigate", id, url),
    browserCommand: (id, action) => invoke("browser-command", id, action),
    browserPresent: (id, bounds) => invoke("browser-present", id, bounds),
    browserPick: (id) => invoke("browser-pick", id),
    browserClose: (id) => invoke("browser-close", id),
    browserExternal: (url) => invoke("browser-external", url),
    previewOpen: (url) => invoke("preview-open", url),
    subscribe(listener) {
      const forward = (_event: Electron.IpcRendererEvent, payload: WorkbenchEvent) =>
        listener(payload)
      ipcRenderer.on("pigclaude:workbench-event", forward)
      return () => ipcRenderer.removeListener("pigclaude:workbench-event", forward)
    },
  }
}
