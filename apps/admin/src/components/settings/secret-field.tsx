// 负责迁入固定 Pigcursor 设置布局的secret-field，保留原样式与交互。
import { useState } from "react"
import { Eye, EyeOff, Lock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

/** 机密字段的状态徽章：「只写不回显」+ 是否已配置（来自 GET 响应的 `${base}_set`）。 */
export function SecretBadges({ isSet }: { isSet: boolean }) {
  return (
    <>
      <Badge variant="outline" className="gap-1 px-1.5 text-[10.5px] leading-4 text-meta">
        <Lock className="size-2.5!" />
        只写不回显
      </Badge>
      {isSet ? (
        <Badge variant="success" className="px-1.5 text-[10.5px] leading-4">
          已配置
        </Badge>
      ) : (
        <Badge variant="neutral" className="px-1.5 text-[10.5px] leading-4">
          未配置
        </Badge>
      )}
    </>
  )
}

interface SecretInputProps {
  id: string
  /** 来自 GET 响应的 `${base}_set`：是否已配置（服务端已核实：GET 永不下发 `_enc`）。 */
  isSet: boolean
  disabled?: boolean
  /** 明文草稿值；永不由服务端预填。 */
  value: string
  onChange: (value: string) => void
}

/**
 * 机密输入：默认 `type=password`、永不预填服务端值，placeholder 依 `isSet` 显示
 * 「已配置 — 输入新值以覆盖」或「未配置」；右侧眼睛按钮只切换本地草稿的显隐，便于核对刚输入的新值。
 */
export function SecretInput({ id, isSet, value, onChange, disabled = false }: SecretInputProps) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        disabled={disabled}
        type={visible ? "text" : "password"}
        autoComplete="new-password"
        className="pr-9 font-mono"
        placeholder={isSet ? "已配置 — 输入新值以覆盖" : "未配置"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled || !value}
        aria-label={visible ? "隐藏输入内容" : "显示输入内容"}
        className="absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-meta transition-colors outline-none hover:bg-raise-2 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-40"
      >
        {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  )
}
