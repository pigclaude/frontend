// 显示从历史会话续接失败的原因，用户可以保留旧会话并另开草稿。

import { Button } from "@pigclaude/ui-primitives"
import { useState } from "react"
import { useText } from "../locale/text"
import type { SessionErrorView } from "../models/session-errors"

const recoverable = new Set([
  "SESSION_RESUME_FAILED",
  "NO_AVAILABLE_ACCOUNT",
  "WORKSPACE_UNAVAILABLE",
])

/** 显示续接失败的原因和新建会话并引用原会话的操作。 */
export function SessionResumeError({
  error,
  onRecover,
}: {
  error: SessionErrorView
  onRecover?: (() => Promise<void>) | undefined
}) {
  const { t } = useText()
  const [opening, setOpening] = useState(false)
  async function open(): Promise<void> {
    setOpening(true)
    try {
      await onRecover?.()
    } finally {
      setOpening(false)
    }
  }
  return (
    <div className="session-resume-error error-text" role="alert">
      <span>
        {error.code === "NO_AVAILABLE_ACCOUNT"
          ? t("shell.session.noOriginalAccount")
          : error.message}
      </span>
      {onRecover && recoverable.has(error.code) ? (
        <Button size="sm" variant="ghost" disabled={opening} onClick={() => void open()}>
          {t("shell.session.recoverReference")}
        </Button>
      ) : null}
    </div>
  )
}
