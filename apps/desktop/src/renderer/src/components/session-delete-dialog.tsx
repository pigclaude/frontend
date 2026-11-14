// 负责会话单项和全部历史的删除确认，删除失败时保留对话框。

import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog"
import { fill, useText } from "../locale/text"
import type { SessionHistoryController } from "../hooks/use-session-history"

/** 用户确认前不删除会话；执行中保持对话框打开，失败时显示原因。 */
export function SessionDeleteDialog({ history }: { history: SessionHistoryController }) {
  const { t } = useText()
  const { deletion } = history
  if (deletion === null) return null
  const title =
    deletion.kind === "all"
      ? t("shell.session.clearTitle")
      : fill(t("shell.session.deleteTitle"), {
          title: deletion.session.title || t("shell.session.untitled"),
        })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) history.promptDeletion(null)
      }}
    >
      <DialogContent>
        <div className="dialog-head">
          <div className="dialog-heading">
            <DialogTitle className="dialog-title">{title}</DialogTitle>
            <DialogDescription className="dialog-desc">
              {t("shell.session.deleteDescription")}
            </DialogDescription>
          </div>
        </div>
        {history.deleteError !== null ? (
          <p className="error-text" role="alert">
            {history.deleteError}
          </p>
        ) : null}
        <div className="dialog-foot">
          <Button
            variant="ghost"
            disabled={history.deleting}
            onClick={() => history.promptDeletion(null)}
          >
            {t("shell.session.cancel")}
          </Button>
          <Button
            variant="solidDanger"
            disabled={history.deleting}
            onClick={() => void history.confirmDeletion()}
          >
            {deletion.kind === "all" ? t("shell.session.clear") : t("shell.session.delete")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
