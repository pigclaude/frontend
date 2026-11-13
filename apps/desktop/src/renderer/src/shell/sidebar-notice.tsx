// 负责工作区侧栏底部上方的账号提醒：有 Claude 账号需要重新授权时提示，并说明它已暂停参与自动切换。
// 提醒只来自真实的账号状态，没有需要处理的账号时不显示；隐藏后同一批账号不再提醒。
import { useState } from "react"
import { Button, StatusDot } from "@pigclaude/ui-primitives"
import { Icon } from "@pigclaude/ui-shell"
import { fill, useText } from "../locale/text"

/** 需要提醒的账号。 */
export type NoticeAccount = { id: string; name: string }

/** 提醒标题：一个账号写出名字，多个账号写数量。 */
export function noticeTitle(
  accounts: readonly NoticeAccount[],
  templates: { one: string; many: string },
): string {
  const [first] = accounts
  if (!first) return ""
  return accounts.length === 1
    ? fill(templates.one, { name: first.name })
    : fill(templates.many, { count: accounts.length })
}

/** 有需要重新授权的账号时画提醒；点开进入 Claude 账号页。 */
export function SidebarNotice({
  accounts,
  onOpen,
}: {
  accounts: readonly NoticeAccount[]
  onOpen: () => void
}) {
  const { t } = useText()
  const key = accounts.map((account) => account.id).join(",")
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (accounts.length === 0 || dismissed === key) return null
  return (
    <div className="side-notice">
      <button type="button" className="side-notice-main" onClick={onOpen}>
        <StatusDot tone="warning" />
        <span className="side-notice-text">
          <span className="side-notice-title truncate">
            {noticeTitle(accounts, {
              one: t("shell.notice.reauth"),
              many: t("shell.notice.reauthMany"),
            })}
          </span>
          <span className="side-notice-desc">{t("shell.notice.paused")}</span>
        </span>
      </button>
      <Button
        variant="plain"
        className="icon-btn side-notice-close"
        type="button"
        aria-label={t("shell.notice.dismiss")}
        title={t("shell.notice.dismiss")}
        onClick={() => setDismissed(key)}
      >
        <Icon name="x" small />
      </Button>
    </div>
  )
}
