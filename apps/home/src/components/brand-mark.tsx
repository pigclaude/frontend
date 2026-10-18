// 负责保留原 Pigcursor 品牌标记的 SVG 几何与主题配色。
type BrandMarkTone = "mono" | "brand" | "inverse"

/** 沿用 Pigcursor 原标记路径，填色随当前主题表面变化。 */
export function BrandMark({
  className,
  tone = "mono",
  framed = false,
}: {
  className?: string
  tone?: BrandMarkTone
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
