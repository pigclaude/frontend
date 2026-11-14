// 负责工作区侧栏底部上方的提醒：有 Claude 账号需要重新授权时提示，并说明它已暂停参与自动切换；
// 会话进行时显示本次会话用的 Claude 账号和网络。提醒只来自真实状态，不显示代理地址或凭据。
import { useState } from "react"
import type { ClaudeAccountView, ProxyView } from "@pigclaude/contracts/claude-account"
import { Button, StatusDot, type StatusTone } from "@pigclaude/ui-primitives"
import { Icon } from "@pigclaude/ui-shell"
import { fill, useText, type TextKey } from "../locale/text"

/** 需要提醒的账号。 */
export type NoticeAccount = { id: string; name: string }

/** 会话所用账号和网络；网络只给出代理名称或系统网络，不含代理地址。 */
export type SessionNotice = {
  account: string
  network: { kind: "proxy"; name: string } | { kind: "direct" } | { kind: "missing" }
}

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

/** 会话进行时要显示的账号和网络；会话没在进行或还不知道用的哪个账号时返回 null。 */
export function sessionNotice(input: {
  live: boolean
  accountId: string | null
  accounts: readonly Pick<ClaudeAccountView, "id" | "displayName" | "proxyId">[]
  proxies: readonly Pick<ProxyView, "id" | "name">[]
}): SessionNotice | null {
  if (!input.live || input.accountId === null) return null
  const account = input.accounts.find((item) => item.id === input.accountId)
  if (!account) return null
  if (account.proxyId === null) return { account: account.displayName, network: { kind: "direct" } }
  const proxy = input.proxies.find((item) => item.id === account.proxyId)
  return {
    account: account.displayName,
    network: proxy ? { kind: "proxy", name: proxy.name } : { kind: "missing" },
  }
}

/** 网络那一行的状态点和文字；绑定的代理已不存在时用错误色。 */
function networkLine(
  network: SessionNotice["network"],
  t: (key: TextKey) => string,
): { tone: StatusTone; text: string } {
  switch (network.kind) {
    case "proxy":
      return { tone: "ready", text: fill(t("shell.notice.sessionProxy"), { name: network.name }) }
    case "direct":
      return { tone: "ready", text: t("shell.notice.sessionDirect") }
    case "missing":
      return { tone: "error", text: t("shell.notice.sessionProxyMissing") }
  }
}

/** 先画重新授权提醒，再画会话的账号和网络；点开都进入 Claude 账号页。 */
export function SidebarNotice({
  accounts,
  session,
  onOpen,
}: {
  accounts: readonly NoticeAccount[]
  session: SessionNotice | null
  onOpen: () => void
}) {
  const { t } = useText()
  const key = accounts.map((account) => account.id).join(",")
  const [dismissed, setDismissed] = useState<string | null>(null)
  const reauth = accounts.length > 0 && dismissed !== key
  if (!reauth && session === null) return null
  const network = session ? networkLine(session.network, t) : null
  return (
    <>
      {reauth ? (
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
      ) : null}
      {session && network ? (
        <div className="side-notice">
          <button type="button" className="side-notice-main" onClick={onOpen}>
            <StatusDot tone={network.tone} />
            <span className="side-notice-text">
              <span className="side-notice-title truncate">
                {fill(t("shell.notice.session"), { name: session.account })}
              </span>
              <span className="side-notice-desc truncate">{network.text}</span>
            </span>
          </button>
        </div>
      ) : null}
    </>
  )
}
