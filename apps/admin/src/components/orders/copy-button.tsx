// 负责订单复制控件的嵌套交互隔离和明确的浏览器反馈。
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { OrderCopyIcon } from "@/components/icon"
/** 复制完整服务端文本，阻止点击及键盘事件冒泡打开订单详情。 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [feedback, setFeedback] = useState("")
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`复制${label}`}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          if (!navigator.clipboard?.writeText) {
            setFeedback("浏览器不支持复制，请手动复制")
            return
          }
          void navigator.clipboard.writeText(value).then(
            () => setFeedback("已复制"),
            () => setFeedback("复制失败，请手动复制"),
          )
        }}
      >
        <OrderCopyIcon className="size-4" />
      </Button>
      <span role="status" className="text-xs text-muted-foreground">
        {feedback}
      </span>
    </span>
  )
}
