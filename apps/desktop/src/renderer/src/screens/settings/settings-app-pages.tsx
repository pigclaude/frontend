// 负责「通用」「会话」「托盘与菜单栏」三个应用设置页；「外观」见 appearance/appearance-page.tsx。
import { useState } from "react"
import { useToast } from "../../components/toast"
import { Button } from "../../components/ui/button"
import { Kbd } from "../../components/ui/kbd"
import { Switch } from "../../components/ui/switch"
import type { Screen } from "../screen"
import { LockedValue, Segmented, SelectControl } from "./setting-controls"
import { SettingPage, SettingRow, SettingSection } from "./setting-page"

/** 通用：启动、Dock、快捷键、更新和侧栏会话分组。 */
export function GeneralSettings() {
  const toast = useToast()
  const [grouping, setGrouping] = useState<"project" | "time">("project")
  return (
    <SettingPage title="通用">
      <SettingSection title="启动">
        <SettingRow title="开机自动启动" description="中继随应用常驻后台">
          <Switch defaultChecked aria-label="开机自动启动" />
        </SettingRow>
        <SettingRow title="在 Dock 中显示" description="关闭后只出现在菜单栏">
          <Switch aria-label="在 Dock 中显示" />
        </SettingRow>
      </SettingSection>
      <SettingSection title="快捷键">
        <SettingRow title="呼出托盘面板" description="在任何应用里都能用">
          <Kbd>⌥ ⌘ P</Kbd>
          <Button size="sm" onClick={() => toast("请按下新的组合键", "pencil")}>
            修改
          </Button>
        </SettingRow>
      </SettingSection>
      <SettingSection title="更新">
        <SettingRow title="自动检查更新" description="当前 0.1.0，已是最新">
          <Switch defaultChecked aria-label="自动检查更新" />
        </SettingRow>
      </SettingSection>
      <SettingSection title="侧栏">
        <SettingRow title="侧栏会话">
          <Segmented
            label="侧栏会话分组"
            value={grouping}
            onChange={setGrouping}
            options={[
              { value: "project", label: "按项目" },
              { value: "time", label: "按时间" },
            ]}
          />
        </SettingRow>
      </SettingSection>
    </SettingPage>
  )
}

/** 会话：新会话默认值和会话进程的固定规则。 */
export function SessionSettings() {
  const toast = useToast()
  const [model, setModel] = useState("Sonnet 5.5")
  const [permission, setPermission] = useState("每次询问")
  const [source, setSource] = useState<"bundled" | "local">("bundled")
  return (
    <SettingPage title="会话" sub="新会话的默认值，以及会话进程怎么运行">
      <SettingSection title="默认值">
        <SettingRow title="默认工作区" description="~/workspace/pigclaude/frontend" mono>
          <Button size="sm" onClick={() => toast("已打开文件夹选择", "folder")}>
            选择
          </Button>
        </SettingRow>
        <SettingRow title="默认模型">
          <SelectControl
            label="默认模型"
            value={model}
            width={150}
            options={["Sonnet 5.5", "Opus 5.5", "Haiku 5.5"]}
            onChange={setModel}
          />
        </SettingRow>
        <SettingRow title="默认权限" description="新会话里 Claude 改文件、跑命令前怎么确认">
          <SelectControl
            label="默认权限"
            value={permission}
            width={150}
            options={["每次询问", "自动改文件", "只做计划"]}
            onChange={setPermission}
          />
        </SettingRow>
      </SettingSection>
      <SettingSection title="会话进程">
        <SettingRow title="Claude Code" description="无界面运行，由 Agent SDK 驱动">
          <Segmented
            label="Claude Code 来源"
            value={source}
            onChange={setSource}
            options={[
              { value: "bundled", label: "内置 2.1.296" },
              { value: "local", label: "本机安装" },
            ]}
          />
        </SettingRow>
        <SettingRow
          title="读取 ~/.claude/settings.json"
          description="会话的地址和凭据只由 pigclaude 决定"
        >
          <LockedValue>始终关闭</LockedValue>
        </SettingRow>
        <SettingRow
          title="时区与语言"
          description="已绑定代理时跟随代理出口，未绑定代理时使用系统网络"
        >
          <LockedValue>跟随网络出口</LockedValue>
        </SettingRow>
      </SettingSection>
    </SettingPage>
  )
}

/** 托盘与菜单栏：菜单栏文字和托盘面板内容。 */
export function MenubarSettings({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const [label, setLabel] = useState("62% · 主力")
  return (
    <SettingPage
      title="托盘与菜单栏"
      actions={
        <Button variant="ghost" onClick={() => onNavigate("tray")}>
          预览托盘
        </Button>
      }
    >
      <SettingSection>
        <SettingRow title="菜单栏文字" description="太长会被刘海屏隐藏">
          <SelectControl
            label="菜单栏文字"
            value={label}
            width={160}
            options={["62% · 主力", "62%", "只显示图标"]}
            onChange={setLabel}
          />
        </SettingRow>
        <SettingRow title="托盘里显示需要处理的事" description="例如账号需要重新授权、代理不通">
          <Switch defaultChecked aria-label="托盘里显示需要处理的事" />
        </SettingRow>
        <SettingRow title="托盘里显示号池" description="每个账号的 5 小时额度">
          <Switch defaultChecked aria-label="托盘里显示号池" />
        </SettingRow>
      </SettingSection>
    </SettingPage>
  )
}
