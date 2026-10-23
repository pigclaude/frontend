// 提供固定会员卡面及可复用的单选分组键盘行为，不依赖业务 API。
import { useLayoutEffect, useRef, type ReactNode } from "react"

/** 会员卡面与服务端预设一致，保持共享组件独立。 */
export type MembershipCardStyle = "azure" | "gold" | "obsidian" | "violet" | "emerald" | "rose"

/** 以单一 Tab 入口和方向键支持组内所有可用会员选项。 */
export function MembershipCardGroup({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const nodes = ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    if (!nodes) return
    const radios = Array.from(nodes)
    const enabled = radios.filter((radio) => !radio.disabled)
    const entry =
      enabled.find((radio) => radio.getAttribute("aria-checked") === "true") ?? enabled[0]
    for (const radio of radios) radio.tabIndex = radio === entry ? 0 : -1
  })
  return (
    <div
      ref={ref}
      className="membership-card-group"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        const direction = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
        if (!direction && event.key !== "Home" && event.key !== "End") return
        const radios = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
        ).filter(
          (radio) =>
            !radio.disabled && radio.closest('[role="radiogroup"]') === event.currentTarget,
        )
        const current = radios.indexOf(event.target as HTMLButtonElement)
        if (current < 0 || !radios.length) return
        event.preventDefault()
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? radios.length - 1
              : (current + (direction ?? 0) + radios.length) % radios.length
        const next = radios[index]
        for (const radio of radios) radio.tabIndex = radio === next ? 0 : -1
        next.focus()
        next.click()
      }}
    >
      {children}
    </div>
  )
}

/** 展示等级信息；提供选择回调时使用原生按钮承载单选语义。 */
export function MembershipCard(props: {
  name: string
  cardStyle: MembershipCardStyle
  size?: "lg" | "sm"
  eyebrow?: ReactNode
  tagline?: ReactNode
  price?: ReactNode
  footer?: ReactNode
  selected?: boolean
  disabled?: boolean
  dimmed?: boolean
  glint?: boolean
  onSelect?: () => void
}) {
  const content = (
    <>
      {props.onSelect && <span className="membership-card-radio" aria-hidden="true" />}
      <span className="membership-card-name">{props.name}</span>
      {props.eyebrow != null && <span className="membership-card-eyebrow">{props.eyebrow}</span>}
      {props.tagline != null && <span className="membership-card-tagline">{props.tagline}</span>}
      {props.price != null && <span className="membership-card-price">{props.price}</span>}
      {props.footer != null && <span className="membership-card-footer">{props.footer}</span>}
    </>
  )
  const attributes = {
    className: "membership-card",
    "data-style": props.cardStyle,
    "data-size": props.size ?? "lg",
    "data-selected": !!props.selected,
    "data-dimmed": !!props.dimmed,
    "data-glint": !!props.glint,
    "data-disabled": !!props.disabled,
  }
  return props.onSelect ? (
    <button
      {...attributes}
      type="button"
      role="radio"
      aria-checked={!!props.selected}
      aria-disabled={!!props.disabled}
      disabled={props.disabled}
      tabIndex={props.disabled ? -1 : 0}
      onClick={props.onSelect}
    >
      {content}
    </button>
  ) : (
    <div {...attributes}>{content}</div>
  )
}
