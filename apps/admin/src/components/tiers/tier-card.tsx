// 负责单张等级管理卡片，展示服务端有效会员数和档位。
import type { Tier } from "@pigclaude/api/membership/types"
import { MembershipCard } from "@pigclaude/web-ui/components/membership-card"
import { TierBadge } from "@pigclaude/web-ui/components/tier-badge"
import { formatFen } from "@pigclaude/web-ui/lib/format"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
/** 只读卡片隐藏全部写入口。 */
export function TierCard({
  tier,
  canWrite,
  onEdit,
  onDelete,
  onToggle,
}: {
  tier: Tier
  canWrite: boolean
  onEdit: (tier: Tier) => void
  onDelete: (tier: Tier) => void
  onToggle: (tier: Tier) => void
}) {
  return (
    <article className="space-y-4 rounded-xl border p-4">
      <MembershipCard
        size="sm"
        name={tier.name}
        cardStyle={tier.cardStyle}
        eyebrow={
          <TierBadge name={`${tier.code} · 等级 ${tier.level}`} cardStyle={tier.cardStyle} />
        }
        price={`${formatFen(tier.monthlyPriceFen)}/月`}
      />
      <ul>
        {tier.options.map((option) => (
          <li key={option.id}>
            {option.months} 个月 · {formatFen(option.priceFen)} {option.badge}{" "}
            {option.recommended && "推荐"}
            <p className="text-sm text-muted-foreground">
              {option.discountKind === "none"
                ? "无优惠"
                : option.discountKind === "amount"
                  ? `立减 ${formatFen(option.discountValue)}`
                  : `打折 · 省 ${formatFen(option.savedFen)}`}{" "}
              · 按月购买 {formatFen(option.monthlyPurchaseFen)}
            </p>
          </li>
        ))}
      </ul>
      <footer className="flex items-center gap-2">
        {canWrite && (
          <Switch
            aria-label={`上架 ${tier.name}`}
            checked={tier.enabled}
            onCheckedChange={() => onToggle(tier)}
          />
        )}
        <span className="mr-auto text-sm">{tier.activeMemberCount ?? 0} 位有效会员</span>
        <Button
          variant="ghost"
          aria-label={`${canWrite ? "编辑" : "查看"} ${tier.name}`}
          onClick={() => onEdit(tier)}
        >
          {canWrite ? "编辑" : "查看"}
        </Button>
        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" aria-label={`更多 ${tier.name}`}>
                …
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => onDelete(tier)}>删除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </footer>
    </article>
  )
}
