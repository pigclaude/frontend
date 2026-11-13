// 负责工作区侧栏底部一行：当前网站用户的账户菜单（我的账户、Claude 账号、设置、深浅色、退出登录）与设置按钮。
// 用户信息来自会员状态，没有用户时显示「未登录」，不显示示例数据。
import { Button, Menu, formatShortcut, useLocale } from "@pigclaude/ui-primitives"
import { Icon } from "@pigclaude/ui-shell"
import { useText } from "../locale/text"

/** 底部账户行需要的用户信息与事件。 */
export type SidebarFooterProps = {
  account: { nickname: string; email: string } | null
  theme: "light" | "dark"
  onOpenProfile: () => void
  onOpenClaudeAccounts: () => void
  onOpenSettings: () => void
  onToggleTheme: () => void
  onLogout: () => void
}

/** 名字的第一个字，作头像；没有名字时用邮箱的第一个字。 */
export function accountInitial(account: { nickname: string; email: string } | null): string {
  const source = account?.nickname.trim() || account?.email.trim() || ""
  return [...source][0]?.toUpperCase() ?? ""
}

/** 画底部一行；菜单向上展开。 */
export function SidebarFooter(props: SidebarFooterProps) {
  const { t: pt } = useLocale()
  const { t } = useText()
  const name =
    props.account?.nickname.trim() || props.account?.email || t("shell.account.signedOut")
  const initial = accountInitial(props.account)
  return (
    <div className="side-foot">
      <Menu.Root>
        <Menu.Trigger className="side-account account-trigger" aria-label={t("shell.account.menu")}>
          <span className="side-avatar" aria-hidden="true">
            {initial || <Icon name="user" />}
          </span>
          <span className="truncate">{name}</span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="top" align="start" sideOffset={6}>
            <Menu.Popup className="account-menu">
              {props.account ? (
                <div className="account-menu-user">
                  <span className="account-menu-name truncate">{name}</span>
                  <span className="account-menu-mail truncate">{props.account.email}</span>
                </div>
              ) : null}
              {props.account ? <Menu.Separator /> : null}
              <Menu.Item onClick={props.onOpenProfile}>
                <Icon name="user" small />
                <span className="grow">{t("shell.account.profile")}</span>
              </Menu.Item>
              <Menu.Item onClick={props.onOpenClaudeAccounts}>
                <Icon name="users" small />
                <span className="grow">{t("shell.account.claudeAccounts")}</span>
              </Menu.Item>
              <Menu.Item onClick={props.onOpenSettings}>
                <Icon name="gear" small />
                <span className="grow">{t("shell.account.settings")}</span>
                <span className="menu-meta">{formatShortcut("Mod+,")}</span>
              </Menu.Item>
              <Menu.Item onClick={props.onToggleTheme}>
                <Icon name={props.theme === "light" ? "moon" : "sun"} small />
                <span className="grow">
                  {props.theme === "light"
                    ? t("shell.account.themeDark")
                    : t("shell.account.themeLight")}
                </span>
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item onClick={props.onLogout}>
                <Icon name="exit" small />
                <span className="grow">{t("shell.account.logout")}</span>
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <Button
        variant="plain"
        className="icon-btn foot-gear"
        type="button"
        aria-label={pt("settings.title")}
        title={`${pt("settings.title")} ${formatShortcut("Mod+,")}`}
        onClick={props.onOpenSettings}
      >
        <Icon name="gear" />
      </Button>
    </div>
  )
}
