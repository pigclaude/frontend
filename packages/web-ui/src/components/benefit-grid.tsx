// 展示共享会员权益清单及手绘的 24 格勾线图标。

/** 空权益不占位，非空权益使用可读列表和装饰性勾线图标。 */
export function BenefitGrid({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <ul className="benefit-grid">
      {items.map((item, index) => (
        <li key={`${index}:${item}`}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5 12 4 4L19 6" />
          </svg>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}
