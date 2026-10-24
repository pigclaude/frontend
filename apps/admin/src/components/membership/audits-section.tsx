// 负责迁入成熟后台的audits-section布局和交互，使用本项目真实 API。
import { useState } from "react"
import type { MembershipAuditItem } from "@pigclaude/api/admin/types"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatTime } from "@/lib/format"
import { TableCard } from "@/components/shell/table-card"
import { useCursorPager } from "@/hooks/use-cursor-pager"
import { adminApi } from "@/lib/api"
import {
  EmptyRow,
  FilterToolbar,
  InlineLoadError,
  LoadingRows,
  PagerFooter,
  maskIdentifier,
  normalizeUserId,
} from "./table-parts"

/** AuditsSection 保持列表、表单或分页的既有交互契约。 */
export function AuditsSection() {
  const [userInput, setUserInput] = useState("")
  const [userId, setUserId] = useState("")
  const [eventInput, setEventInput] = useState("")
  const [eventType, setEventType] = useState("")
  const pager = useCursorPager(["admin-audits", userId, eventType], (cursor) =>
    adminApi.audits.list({
      userId: userId || undefined,
      eventType: eventType || undefined,
      cursor,
      limit: 20,
    }),
  )

  return (
    <TableCard
      toolbar={
        <FilterToolbar
          title="安全审计"
          userLabel="审计用户筛选"
          userInput={userInput}
          onUserInput={setUserInput}
          onApply={() => {
            setUserId(normalizeUserId(userInput))
            setEventType(eventInput.trim())
          }}
        >
          <Input
            value={eventInput}
            onChange={(event) => setEventInput(event.target.value)}
            placeholder="事件类型"
            aria-label="审计事件筛选"
          />
        </FilterToolbar>
      }
      footer={<PagerFooter pager={pager} noun="条审计" />}
    >
      {pager.isError && pager.items.length === 0 ? (
        <InlineLoadError message="审计列表加载失败" onRetry={pager.retry} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>时间</TableHead>
              <TableHead>用户 / 操作人</TableHead>
              <TableHead>事件 / 结果</TableHead>
              <TableHead>设备 / Epoch</TableHead>
              <TableHead>原因 / 客户端</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pager.isPending ? (
              <LoadingRows columns={5} />
            ) : pager.items.length === 0 ? (
              <EmptyRow columns={5} message="暂无安全审计记录" />
            ) : (
              pager.items.map((item) => <AuditRow key={item.id} item={item} />)
            )}
          </TableBody>
        </Table>
      )}
    </TableCard>
  )
}

/** AuditRow 保持列表、表单或分页的既有交互契约。 */
function AuditRow({ item }: { item: MembershipAuditItem }) {
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">
        {item.createdAt ? formatTime(item.createdAt) : "—"}
      </TableCell>
      <TableCell>
        <p className="font-mono text-foreground">{item.userId ?? "—"}</p>
        <p className="mt-0.5 text-xs text-meta">
          {item.operatorType} · {item.operatorId || "—"}
        </p>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{item.eventType}</Badge>
        <p className="mt-1 text-xs text-meta">结果：{item.result || "—"}</p>
      </TableCell>
      <TableCell className="font-mono text-xs">
        <p>{item.deviceId ? maskIdentifier(item.deviceId) : "—"}</p>
        <p className="mt-0.5 text-meta">epoch {item.bindingEpoch}</p>
      </TableCell>
      <TableCell className="max-w-[420px] whitespace-normal">
        <p>{item.reason || "—"}</p>
        <p className="mt-0.5 text-xs text-meta">
          {[item.clientIp, item.userAgent].filter(Boolean).join(" · ") || "无客户端信息"}
        </p>
      </TableCell>
    </TableRow>
  )
}
