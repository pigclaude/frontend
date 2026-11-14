// 显示从历史会话续接失败的原因，用户可以保留旧会话并另开草稿。

import { Button } from "@pigclaude/ui-primitives"
import { useText } from "../locale/text"

/** 会话停放期间的续接错误，并提供在其所属项目新建会话的入口。 */
export function SessionResumeError({
  error,
  onNewSession,
}: {
  error: string
  onNewSession: () => void
}) {
  const { t } = useText()
  return (
    <div className="session-resume-error error-text" role="alert">
      <span>{error}</span>
      <Button size="sm" variant="ghost" onClick={onNewSession}>
        {t("shell.session.untitled")}
      </Button>
    </div>
  )
}
