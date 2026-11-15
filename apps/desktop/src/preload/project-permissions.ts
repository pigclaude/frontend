// 将设置页对项目授权的查询与撤销转发给主进程。

import { ipcRenderer } from "electron"
import type { ProjectPermissionsBridge } from "../project-permissions-contract"

/** 只暴露查询和按 id 撤销的桌面桥。 */
export function projectPermissionsBridge(): ProjectPermissionsBridge {
  return {
    list: () => ipcRenderer.invoke("pigclaude:project-permissions-list"),
    revoke: (id) => ipcRenderer.invoke("pigclaude:project-permissions-revoke", id),
  }
}
