// 负责迁入固定 Pigcursor 设置布局的setting-row，保留原样式与交互。
import type { ReactNode } from "react"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** 设置分组：可选小标题 + 行列表（行间细分隔）；分组之间由外层 divide 分隔。 */
export function SettingSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && (
        <h3 className="px-5 pt-5 pb-1 text-xs font-medium tracking-[0.02em] text-meta">{title}</h3>
      )}
      <div className="divide-y divide-border-soft">{children}</div>
    </section>
  )
}

/**
 * 设置行：左侧标题 / 键名 / 说明，右侧控件。
 * - `inline`：开关类控件，右侧收成自适应宽度并垂直居中；
 * - `dirty`：本行有未保存修改，标题前显示强调色圆点；
 * - `labelFor`：输入类控件的 id（点标题聚焦输入框）；开关类传 `labelId` 供 aria-labelledby。
 */
export function SettingRow({
  title,
  settingKey,
  hint,
  badges,
  dirty = false,
  inline = false,
  labelFor,
  labelId,
  children,
}: {
  title: ReactNode
  settingKey?: string
  hint?: ReactNode
  badges?: ReactNode
  dirty?: boolean
  inline?: boolean
  labelFor?: string
  labelId?: string
  children: ReactNode
}) {
  const Title = labelFor ? "label" : "span"
  return (
    <div
      className={cn(
        "grid gap-x-10 gap-y-3 px-5 py-4 transition-colors",
        inline
          ? "grid-cols-[minmax(0,1fr)_auto] items-center"
          : "xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)] xl:items-start",
        dirty && "bg-[color-mix(in_oklab,var(--accent),transparent_96%)]",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {dirty && (
            <span aria-label="已修改" className="size-1.5 shrink-0 rounded-full bg-primary" />
          )}
          <Title
            id={labelId}
            htmlFor={labelFor}
            className="text-[13px] leading-5 font-medium text-foreground"
          >
            {title}
          </Title>
          {badges}
        </div>
        {settingKey && (
          <code className="mt-0.5 block truncate font-mono text-[11px] leading-4 text-meta">
            {settingKey}
          </code>
        )}
        {hint && (
          <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-muted-foreground">{hint}</p>
        )}
      </div>
      <div className={cn("min-w-0", !inline && "xl:pt-0.5")}>{children}</div>
    </div>
  )
}
