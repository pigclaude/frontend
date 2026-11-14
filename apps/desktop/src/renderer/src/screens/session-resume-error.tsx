// 显示从历史会话续接失败的原因，用户可以保留旧会话并另开草稿。

import { Button } from "@pigclaude/ui-primitives"
import { useState } from "react"
import { useText } from "../locale/text"
import type { SessionErrorView } from "../models/session-errors"

const accountUnavailable = new Set(["NO_AVAILABLE_ACCOUNT", "ACCOUNT_ENVIRONMENT_MISMATCH"])

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
  const sameEnvironmentUnavailable = accountUnavailable.has(error.code)
  const canRecover =
    sameEnvironmentUnavailable ||
    error.code === "SESSION_RESUME_FAILED" ||
    error.code === "WORKSPACE_UNAVAILABLE"
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
        {sameEnvironmentUnavailable ? t("shell.session.noOriginalAccount") : error.message}
      </span>
      {onRecover && canRecover ? (
        <Button size="sm" variant="ghost" disabled={opening} onClick={() => void open()}>
          {t("shell.session.recoverReference")}
        </Button>
      ) : null}
    </div>
  )
}
