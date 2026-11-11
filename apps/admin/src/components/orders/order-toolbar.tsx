// 负责订单服务端筛选入口与独立日期草稿，保留历史等级卡面。
import { useState } from "react"
import type { AdminOrders, AdminOrdersQuery } from "@pigclaude/api/membership/types"
import { TierBadge } from "@pigclaude/web-ui/components/tier-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { OrderTab } from "./order-labels"
const tabs: { value: OrderTab; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待支付" },
  { value: "activated", label: "已生效" },
  { value: "expired", label: "已过期" },
  { value: "closed", label: "已关闭" },
  { value: "attention", label: "待处理" },
]
// 统计卡按北京时间切分今天和本月，筛选输入也按北京时间解释，与浏览器所在时区无关。
function beijing(value: string) {
  return new Date(`${value.length === 16 ? `${value}:00` : value}+08:00`).toISOString()
}
/** 使用 shadcn 控件提交服务器筛选，不在客户端过滤列表。 */
export function OrderToolbar({
  tab,
  onTab,
  count,
  filters,
  tiers,
  filter,
}: {
  tab: OrderTab
  onTab: (tab: OrderTab) => void
  count?: number
  filters: AdminOrdersQuery
  tiers: AdminOrders["filterTiers"]
  filter: (patch: AdminOrdersQuery) => void
}) {
  const [input, setInput] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [open, setOpen] = useState(false)
  // 两个输入格式相同，按字符串比较即可判断先后。
  const reversed = !!from && !!to && from > to
  return (
    <div className="w-full space-y-3">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = tabs.find((item) => item.value === value)
          if (next) onTab(next.value)
        }}
      >
        <TabsList aria-label="订单状态">
          {tabs.map(({ value, label }) => (
            <TabsTrigger key={value} value={value}>
              {label}
              {value === "attention" && count !== undefined && (
                <Badge variant="danger">{count}</Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex flex-wrap items-center gap-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            filter({ q: input.trim() || undefined })
          }}
        >
          <Input
            aria-label="搜索订单"
            placeholder="单号、用户 ID 或邮箱"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={100}
          />
          <Button type="submit" variant="outline">
            搜索
          </Button>
        </form>
        <Select
          value={filters.tierId ?? "all"}
          onValueChange={(value) => filter({ tierId: value === "all" ? undefined : value })}
        >
          <SelectTrigger aria-label="订单等级">
            <SelectValue placeholder="全部等级" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部等级</SelectItem>
            {tiers.map((tier) => (
              <SelectItem key={tier.id} value={tier.id}>
                <TierBadge name={tier.name} cardStyle={tier.cardStyle} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline">时间范围</Button>
          </PopoverTrigger>
          <PopoverContent className="space-y-3 p-4">
            <p className="text-xs text-muted-foreground">按北京时间筛选</p>
            <label className="block space-y-1">
              起始时间
              <Input
                type="datetime-local"
                aria-label="起始时间"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="block space-y-1">
              截止时间
              <Input
                type="datetime-local"
                aria-label="截止时间"
                aria-invalid={reversed}
                aria-describedby={reversed ? "order-range-error" : undefined}
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
            {reversed && (
              <p id="order-range-error" className="text-xs text-danger-ink">
                截止时间不能早于起始时间
              </p>
            )}
            <div className="flex gap-2">
              <Button
                disabled={reversed}
                onClick={() => {
                  filter({
                    from: from ? beijing(from) : undefined,
                    to: to ? beijing(to) : undefined,
                  })
                  setOpen(false)
                }}
              >
                应用
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setFrom("")
                  setTo("")
                  filter({ from: undefined, to: undefined })
                  setOpen(false)
                }}
              >
                清除
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
