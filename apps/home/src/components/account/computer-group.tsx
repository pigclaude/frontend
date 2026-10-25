// 负责设备管理页的「电脑」分组：每台一行，系统图标、名称、活跃与版本信息，以及「⋯」菜单。
"use client"

import { Ellipsis } from "lucide-react"
import type { UserDeviceView } from "@pigclaude/contracts/user-devices"
import { Button } from "@pigclaude/web-ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pigclaude/web-ui/components/dropdown-menu"
import { AppleMark, LinuxMark, WindowsMark } from "@/components/icon"
import { ActivityLabel } from "@/components/account/activity-label"
import { MetaLine, presentParts } from "@/components/account/meta-line"
import { SetGroup, SetRow } from "@/components/account/set-list"

function PlatformMark({ platform }: { platform: UserDeviceView["platform"] }) {
  if (platform === "windows") return <WindowsMark />
  if (platform === "linux") return <LinuxMark />
  return <AppleMark />
}

/** 说明一行：活跃 · 系统版本 · PigClaude 版本 · IP；一项都没有时不渲染说明。 */
function describeComputer(device: UserDeviceView, now: Date) {
  const parts = presentParts([
    device.lastSeenAt && <ActivityLabel lastSeenAt={device.lastSeenAt} now={now} />,
    device.osVersion,
    device.appVersion && `PigClaude ${device.appVersion}`,
    device.lastIp,
  ])
  return parts.length > 0 ? <MetaLine parts={parts} /> : undefined
}

/** 最近活跃的排前面，从没活跃过的排最后。 */
export function sortComputers(devices: readonly UserDeviceView[]): UserDeviceView[] {
  const time = (device: UserDeviceView) =>
    device.lastSeenAt ? new Date(device.lastSeenAt).getTime() || 0 : 0
  return [...devices].sort((left, right) => time(right) - time(left))
}

/**
 * 只展示有效的电脑。页面上不出现设备 ID、绑定代次或原始平台值；网页上也不标「这台电脑」，
 * 因为浏览器拿不到硬件身份。有两台以上时分组标题右侧提供「全部移除」。
 */
export function ComputerGroup({
  devices,
  now,
  pending,
  hasMore,
  loadingMore,
  onLoadMore,
  onRename,
  onRemove,
  onRemoveAll,
}: {
  devices: readonly UserDeviceView[]
  now: Date
  pending: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onRename: (device: UserDeviceView) => void
  onRemove: (device: UserDeviceView) => void
  onRemoveAll: () => void
}) {
  const active = sortComputers(devices.filter((device) => device.status === "active"))
  return (
    <SetGroup
      title={`电脑 · ${active.length} 台`}
      action={
        active.length > 1 ? (
          <button
            type="button"
            className="set-danger-link"
            disabled={pending}
            onClick={onRemoveAll}
          >
            全部移除
          </button>
        ) : undefined
      }
    >
      {active.length === 0 ? (
        <p className="set-empty">还没有在电脑上登录过 PigClaude</p>
      ) : (
        active.map((device) => (
          <SetRow
            key={device.deviceId}
            icon={<PlatformMark platform={device.platform} />}
            title={device.displayName}
            description={describeComputer(device, now)}
            trailing={
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={pending}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`更多操作：${device.displayName}`}
                    className="size-8"
                  >
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onRename(device)}>重命名</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => onRemove(device)}>
                    移除这台电脑
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        ))
      )}
      {hasMore && (
        <div className="set-more">
          <Button variant="ghost" size="sm" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "正在加载…" : "加载更多电脑"}
          </Button>
        </div>
      )}
    </SetGroup>
  )
}
