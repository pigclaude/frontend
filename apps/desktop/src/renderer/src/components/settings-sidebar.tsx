// 负责绘制设置页面的分组导航。
import { Icon } from "./icon"
import type { Screen } from "../screens/screen"

const settingsNav: Array<[string, Array<[Screen, string, string]>]> = [
  ["用户", [["profile", "user", "我的账户"]]],
  [
    "号池",
    [
      ["accounts", "users", "Claude 账号"],
      ["proxies", "globe", "代理"],
      ["switching", "swap", "切换规则"],
    ],
  ],
  [
    "数据",
    [
      ["usage", "bars", "用量"],
      ["environment", "shield", "环境检测"],
    ],
  ],
  [
    "应用",
    [
      ["general", "toggle", "通用"],
      ["appearance", "contrast", "外观"],
      ["session", "terminal", "会话"],
      ["network", "server", "中继与网络"],
      ["data", "database", "数据与隐私"],
      ["about", "info", "关于"],
    ],
  ],
]

/** 绘制设置侧栏并提供返回会话入口。 */
export function SettingsSidebar({
  screen,
  onNavigate,
}: {
  screen: Screen
  onNavigate: (screen: Screen) => void
}) {
  return (
    <>
      <button className="nav-item back" type="button" onClick={() => onNavigate("chat")}>
        <Icon name="left" />
        返回
      </button>
      {settingsNav.map(([group, items]) => (
        <div key={group}>
          <div className="side-group">{group}</div>
          {items.map(([id, icon, label]) => (
            <button
              key={id}
              className={screen === id ? "nav-item is-active" : "nav-item"}
              type="button"
              onClick={() => onNavigate(id)}
            >
              <Icon name={icon} />
              {label}
            </button>
          ))}
        </div>
      ))}
    </>
  )
}
