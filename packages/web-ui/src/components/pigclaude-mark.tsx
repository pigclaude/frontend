// 负责提供本文件的前端契约、组件或样式实现。
import { PigclaudeWordmark } from "./pigclaude-wordmark"

// 导出共享符号，保持包边界稳定。
export { PigclaudeWordmark } from "./pigclaude-wordmark"

type PigclaudeMarkTone = "mono" | "brand" | "inverse"

/** S6 master shared by the website and admin; inline currentColor follows the surface. */
/** 对外导出该符号，保证调用方使用稳定的前端契约。 */
export function PigclaudeMark({
  className,
  tone = "mono",
  framed = false,
}: {
  className?: string
  tone?: PigclaudeMarkTone
  framed?: boolean
}) {
  return (
    <svg
      viewBox={framed ? "100 100 824 824" : "0 0 1024 1024"}
      className={className}
      fill="none"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M340 140C418 140 482 146 552 146C723 146 840 256 840 420C840 586 718 686 550 686H414C370 686 336 714 336 754C336 776 348 790 372 796C412 806 438 827 438 851C438 872 419 884 388 884C266 884 184 789 184 662V304C184 205 243 140 340 140ZM514 276A194 144 0 0 1 708 420A194 144 0 0 1 514 564A194 144 0 0 1 320 420A194 144 0 0 1 514 276Z"
      />
      {tone !== "mono" && (
        <path
          d="M514 276A194 144 0 0 1 708 420A194 144 0 0 1 514 564A194 144 0 0 1 320 420A194 144 0 0 1 514 276Z"
          fill={tone === "inverse" ? "#E0607E" : "var(--brand-mark-snout, #F3C5D2)"}
        />
      )}
      <ellipse cx="426" cy="420" rx="52" ry="62" fill="currentColor" />
      <ellipse cx="602" cy="420" rx="52" ry="62" fill="currentColor" />
    </svg>
  )
}

/** Mark plus the selected rounded path wordmark; the hidden name labels the combination. */
/** 对外导出该符号，保证调用方使用稳定的前端契约。 */
export function PigclaudeLockup({
  className,
  markClassName,
  wordClassName,
}: {
  className?: string
  markClassName?: string
  wordClassName?: string
}) {
  return (
    <span className={className}>
      <PigclaudeMark className={markClassName ?? "size-6"} tone="brand" />
      <PigclaudeWordmark className={wordClassName ?? "h-5 w-auto"} />
      <span className="sr-only">pigclaude</span>
    </span>
  )
}
