// 以共享单选组展示服务端购买时长和价格。
import type { CatalogOption } from "@pigclaude/api/membership/types"
import { DurationCard, DurationCardGroup } from "@pigclaude/web-ui/components/duration-card"
/** 时长保留方向键及单一 Tab 入口。 */
export function DurationPicker({
  options,
  selected,
  onSelect,
}: {
  options: CatalogOption[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  return (
    <section className="membership-section" aria-labelledby="membership-duration">
      <div className="membership-section-head">
        <h2 id="membership-duration">选择时长</h2>
        <small>1 个月按 30 天计</small>
      </div>
      <DurationCardGroup label="购买时长">
        {options.map((option) => (
          <DurationCard
            key={option.id}
            {...option}
            selected={selected === option.id}
            onSelect={() => onSelect(option.id)}
          />
        ))}
      </DurationCardGroup>
    </section>
  )
}
