// 提供固定会员卡面及可复用的单选分组键盘行为，不依赖业务 API。
import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react"

/** 会员卡面与服务端预设一致，保持共享组件独立。 */
export type MembershipCardStyle = "azure" | "gold" | "obsidian" | "violet" | "emerald" | "rose"

/** 以单一 Tab 入口和方向键支持组内所有可用会员选项。 */
export function MembershipCardGroup({
  label,
  children,
  layout,
}: {
  label: string
  children: ReactNode
  layout?: "track"
}) {
  const ref = useRef<HTMLDivElement>(null)
  const aligned = useRef<{ radio: HTMLButtonElement | null; mobile: boolean }>({
    radio: null,
    mobile: false,
  })
  // 只改变轨道的水平位置；缩放中的卡片也按未缩放宽度完整保留。
  const scrollTrackTo = useCallback(
    (radio: HTMLButtonElement) => {
      const group = ref.current
      if (layout !== "track" || !group || getComputedStyle(group).overflowX !== "auto") return
      const box = group.getBoundingClientRect()
      const target = radio.getBoundingClientRect()
      const left =
        target.left - box.left + group.scrollLeft - (radio.offsetWidth - target.width) / 2
      const right = left + radio.offsetWidth
      if (left < group.scrollLeft + 8) group.scrollLeft = Math.max(0, left - 8)
      else if (right > group.scrollLeft + group.clientWidth - 8)
        group.scrollLeft = right - group.clientWidth + 8
    },
    [layout],
  )
  const alignSelection = useCallback(() => {
    const group = ref.current
    if (layout !== "track" || !group) return
    const radio =
      Array.from(
        group.querySelectorAll<HTMLButtonElement>('[role="radio"][aria-checked="true"]'),
      ).find((node) => node.closest('[role="radiogroup"]') === group) ?? null
    const mobile = getComputedStyle(group).overflowX === "auto"
    const previous = aligned.current
    aligned.current = { radio, mobile }
    if (radio && mobile && (previous.radio !== radio || !previous.mobile)) scrollTrackTo(radio)
  }, [layout, scrollTrackTo])
  useLayoutEffect(() => {
    if (layout !== "track" || !ref.current || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(alignSelection)
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [layout, alignSelection])
  useLayoutEffect(() => {
    const nodes = ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    if (!nodes) return
    const radios = Array.from(nodes).filter(
      (radio) => radio.closest('[role="radiogroup"]') === ref.current,
    )
    const enabled = radios.filter((radio) => !radio.disabled)
    const entry =
      enabled.find((radio) => radio.getAttribute("aria-checked") === "true") ?? enabled[0]
    for (const radio of radios) radio.tabIndex = radio === entry ? 0 : -1
    alignSelection()
  })
  return (
    <div
      ref={ref}
      className="membership-card-group"
      data-layout={layout}
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
        next.focus({
          preventScroll:
            layout === "track" && getComputedStyle(event.currentTarget).overflowX === "auto",
        })
        next.click()
        scrollTrackTo(next)
      }}
    >
      {children}
    </div>
  )
}

/** 展示等级信息；提供选择回调时使用原生按钮承载单选语义。xs 只画等级名小卡。 */
export function MembershipCard(props: {
  name: string
  cardStyle: MembershipCardStyle
  size?: "lg" | "sm" | "xs"
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
      {(props.tagline != null || props.price != null) && (
        <span className="membership-card-bottom">
          {props.tagline != null && (
            <span className="membership-card-tagline">{props.tagline}</span>
          )}
          {props.price != null && <span className="membership-card-price">{props.price}</span>}
        </span>
      )}
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
