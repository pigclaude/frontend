// 负责设备管理页：登录过这个账号的电脑和浏览器。
"use client"

import { Suspense, useState } from "react"
import { AccountPageHeader } from "@/components/account/account-page-header"
import { WebSessionGroup } from "@/components/account/web-session-group"
import { DeviceList } from "@/components/devices/device-list"

const header = (
  <AccountPageHeader
    title="设备管理"
    subtitle="登录过你账号的电脑和浏览器。看到不认识的，移除它即可。"
  />
)

/** 两个分组共用同一个「现在」，活跃文案在一次渲染里保持一致。 */
export default function AccountDevicesPage() {
  const [now] = useState(() => new Date())
  return (
    <>
      {header}
      <Suspense>
        <DeviceList now={now} />
      </Suspense>
      <WebSessionGroup now={now} />
    </>
  )
}
