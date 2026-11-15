// 负责读取设置页展示的桌面版本和本机数据目录。

import { useEffect, useState } from "react"
import type { AppInfo } from "../../../preload/index"

/** 桌面桥读取成功前返回 null，浏览器预览中保持为空。 */
export function useDesktopAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    const read = window.pigclaude?.appInfo
    if (!read) return
    void read()
      .then(setInfo)
      .catch(() => undefined)
  }, [])
  return info
}
