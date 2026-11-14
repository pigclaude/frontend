// 负责把会话提示弹成通知，例如自动审批不可用的原因；在任何页面都弹，每条只弹一次。

import { useEffect, useRef } from "react"
import { useToast } from "@pigclaude/ui-shell"
import type { SessionNotice } from "../models/session-model"

/** 出现新的会话提示时弹一次通知；重新渲染不重复，同样的话作为新提示再出现时照常弹。 */
export function useSessionNotices(notice: SessionNotice | null): void {
  const toast = useToast()
  const shown = useRef<SessionNotice | null>(null)
  useEffect(() => {
    if (notice === null || notice === shown.current) return
    shown.current = notice
    toast(notice.message, "alert")
  }, [notice, toast])
}
