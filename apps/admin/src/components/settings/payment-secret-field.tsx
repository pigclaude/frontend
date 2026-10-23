// 负责支付密钥的显式更换、无控输入和完整生命周期清理。
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/** 支付密钥只保留在无控 DOM 与调用者 ref，更换须显式开启。 */
export function SecretField({
  configured,
  disabled,
  onChange,
  resetSignal,
}: {
  configured: boolean
  disabled: boolean
  onChange: (v: string) => void
  resetSignal: number
}) {
  const [replacing, setReplacing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const change = useRef(onChange)
  change.current = onChange
  useEffect(() => {
    if (input.current) input.current.value = ""
    change.current("")
    setReplacing(false)
  }, [resetSignal])
  useEffect(() => {
    const node = input.current
    return () => {
      if (node) node.value = ""
      if (input.current) input.current.value = ""
      change.current("")
    }
  }, [replacing])
  return configured && !replacing ? (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">已配置 · 留空则不修改</span>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setReplacing(true)}
      >
        更换
      </Button>
    </div>
  ) : (
    <Input
      id="payment-key"
      ref={input}
      type="password"
      aria-label="密钥"
      autoComplete="new-password"
      disabled={disabled}
      placeholder={configured ? "已配置，留空则不修改" : "未配置"}
      onChange={(event) => change.current(event.target.value)}
    />
  )
}
