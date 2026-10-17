// 负责设置侧栏的分组、条目和搜索匹配。
import type { Screen } from "../screens/screen"

/** 设置侧栏的一个条目；keywords 是页面里的设置项，用来搜索。 */
export type SettingsNavItem = {
  screen: Screen
  icon: string
  label: string
  keywords: string[]
}

/** 设置侧栏的一个分组。 */
export type SettingsNavGroup = {
  label: string
  items: SettingsNavItem[]
}

/** 设置侧栏的全部分组，顺序与原型一致。 */
export const settingsNav: SettingsNavGroup[] = [
  {
    label: "用户",
    items: [
      {
        screen: "profile",
        icon: "user",
        label: "我的账户",
        keywords: ["使用权限", "登录方式", "密码", "退出登录", "校验"],
      },
    ],
  },
  {
    label: "号池",
    items: [
      {
        screen: "accounts",
        icon: "users",
        label: "Claude 账号",
        keywords: ["授权", "指纹", "额度", "顺序"],
      },
      { screen: "proxies", icon: "globe", label: "代理", keywords: ["出口", "测试", "绑定"] },
      {
        screen: "switching",
        icon: "swap",
        label: "切换规则",
        keywords: ["5 小时窗口", "7 天窗口", "Opus", "换号", "阈值"],
      },
    ],
  },
  {
    label: "数据",
    items: [
      { screen: "usage", icon: "bars", label: "用量", keywords: ["Token", "请求", "导出", "CSV"] },
      {
        screen: "environment",
        icon: "shield",
        label: "环境检测",
        keywords: ["网络路径", "会话进程", "检测"],
      },
    ],
  },
  {
    label: "应用",
    items: [
      {
        screen: "general",
        icon: "toggle",
        label: "通用",
        keywords: ["开机自动启动", "Dock", "快捷键", "更新"],
      },
      {
        screen: "appearance",
        icon: "contrast",
        label: "外观",
        keywords: ["主题", "深色", "浅色", "跟随系统", "侧栏"],
      },
      {
        screen: "session",
        icon: "terminal",
        label: "会话",
        keywords: ["默认工作区", "默认模型", "默认权限", "Claude Code", "时区"],
      },
      {
        screen: "menubar",
        icon: "tray",
        label: "托盘与菜单栏",
        keywords: ["菜单栏文字", "托盘", "号池"],
      },
      {
        screen: "network",
        icon: "server",
        label: "中继与网络",
        keywords: ["中继端口", "代理不通", "出口复查", "重启"],
      },
      {
        screen: "data",
        icon: "database",
        label: "数据与隐私",
        keywords: ["数据目录", "accounts.json", "proxies.json", "清除用量", "保留"],
      },
      { screen: "about", icon: "info", label: "关于", keywords: ["版本", "设计系统"] },
    ],
  },
]

/** 所有属于设置侧栏的页面。 */
export const settingsScreens: ReadonlySet<Screen> = new Set(
  settingsNav.flatMap((group) => group.items.map((item) => item.screen)),
)

/** 按名称或设置项过滤侧栏；空查询原样返回，没有命中的分组会被去掉。 */
export function filterSettingsNav(groups: SettingsNavGroup[], query: string): SettingsNavGroup[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return groups
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        [item.label, ...item.keywords].some((text) => text.toLowerCase().includes(needle)),
      ),
    }))
    .filter((group) => group.items.length > 0)
}
