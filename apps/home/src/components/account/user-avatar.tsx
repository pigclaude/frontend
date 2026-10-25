// 负责顶栏菜单、身份卡和资料行共用的用户头像：有图显示图，无图或加载失败显示首字。
"use client"

import { useState } from "react"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** 首字头像的 8 种底色；白字在每种底色上的对比度都不低于 4.5:1，与明暗主题无关。 */
export const AVATAR_COLORS: readonly string[] = Object.freeze([
  "#3b5bdb",
  "#6352d9",
  "#0b7a75",
  "#2b7a4b",
  "#c2410c",
  "#be185d",
  "#7c3aed",
  "#a16207",
])

/** 按数字用户 ID 对 8 取模选色，同一个用户永远同一种颜色；ID 不是数字时用第一种。 */
export function avatarColor(id: string): string {
  const value = Number(id)
  const index = Number.isSafeInteger(value) && value >= 0 ? value % AVATAR_COLORS.length : 0
  return AVATAR_COLORS[index] ?? "#3b5bdb"
}

/** 取昵称的第一个完整字符（emoji 不拆开），拉丁字母转大写；昵称为空时用 P。 */
function initialOf(nickname: string): string {
  const first = Array.from(nickname.trim())[0]
  return first ? first.toUpperCase() : "P"
}

const SIZE_CLASS = {
  30: "size-[30px] text-[13px]",
  36: "size-9 text-sm",
  60: "size-[60px] text-[22px]",
} as const

/**
 * 渲染圆形头像。只加载 https 地址，并且不带 Referer；图片加载失败后改为首字头像，
 * 不出现裂图。可访问名称始终是昵称。
 */
export function UserAvatar({
  id,
  nickname,
  avatar,
  size,
  className,
}: {
  id: string
  nickname: string
  avatar: string
  size: 30 | 36 | 60
  className?: string
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const label = nickname.trim() || "PigClaude 用户"
  const showImage = avatar.startsWith("https://") && failedSrc !== avatar
  const base = cn(
    "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold",
    SIZE_CLASS[size],
    className,
  )
  if (showImage)
    return (
      // 头像来自第三方域名且尺寸固定，不经过 Next 图片优化。
      <img
        src={avatar}
        alt={label}
        referrerPolicy="no-referrer"
        className={cn(base, "bg-[var(--raise-3)] object-cover")}
        onError={() => setFailedSrc(avatar)}
      />
    )
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(base, "text-white")}
      style={{ backgroundColor: avatarColor(id) }}
    >
      <span aria-hidden="true">{initialOf(nickname)}</span>
    </span>
  )
}
