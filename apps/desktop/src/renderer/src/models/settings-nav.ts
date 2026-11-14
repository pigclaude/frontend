// 负责设置侧栏的分组、条目和搜索匹配。

/** 设置页的 id，也是导航位置里 settings 的 page。 */
export type SettingsPageId =
  | "profile"
  | "accounts"
  | "browser-profiles"
  | "proxies"
  | "switching"
  | "usage"
  | "environment"
  | "general"
  | "appearance"
  | "session"
  | "menubar"
  | "network"
  | "data"
  | "archived"
  | "about"

/** 设置侧栏的一个条目；keywords 是页面里的设置项，用来搜索。 */
export type SettingsNavItem = {
  page: SettingsPageId
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
        page: "profile",
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
        page: "accounts",
        icon: "users",
        label: "Claude 账号",
        keywords: ["授权", "指纹", "额度", "顺序"],
      },
      {
        page: "browser-profiles",
        icon: "finger",
        label: "浏览器指纹",
        keywords: ["实例", "配置", "语言", "时区", "CLI", "绑定"],
      },
      { page: "proxies", icon: "globe", label: "代理", keywords: ["出口", "测试", "绑定"] },
      {
        page: "switching",
        icon: "swap",
        label: "切换规则",
        keywords: ["5 小时窗口", "7 天窗口", "Opus", "换号", "阈值"],
      },
    ],
  },
  {
    label: "数据",
    items: [
      { page: "usage", icon: "bars", label: "用量", keywords: ["Token", "请求", "导出", "CSV"] },
      {
        page: "environment",
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
        page: "general",
        icon: "toggle",
        label: "通用",
        keywords: ["开机自动启动", "Dock", "快捷键", "更新"],
      },
      {
        page: "appearance",
        icon: "contrast",
        label: "外观",
        keywords: ["主题", "深色", "浅色", "跟随系统", "侧栏"],
      },
      {
        page: "session",
        icon: "terminal",
        label: "会话",
        keywords: ["默认工作区", "默认模型", "默认权限", "Claude Code", "时区"],
      },
      {
        page: "menubar",
        icon: "tray",
        label: "托盘与菜单栏",
        keywords: ["菜单栏文字", "托盘", "号池"],
      },
      {
        page: "network",
        icon: "server",
        label: "中继与网络",
        keywords: ["中继端口", "代理不通", "出口复查", "重启"],
      },
      {
        page: "data",
        icon: "database",
        label: "数据与隐私",
        keywords: ["数据目录", "accounts.json", "proxies.json", "清除用量", "保留"],
      },
      {
        page: "archived",
        icon: "archive",
        label: "已归档",
        keywords: ["会话", "取消归档", "删除"],
      },
      { page: "about", icon: "info", label: "关于", keywords: ["版本", "设计系统"] },
    ],
  },
]

/** 所有设置页的 id。 */
export const settingsPages: ReadonlySet<string> = new Set(
  settingsNav.flatMap((group) => group.items.map((item) => item.page)),
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
