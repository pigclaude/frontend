// 负责权益条目的添加、删除和顺序编辑。
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
/** 保留输入原文，提交时由统一校验器 trim。 */
export function BenefitListEditor({
  value,
  disabled,
  onChange,
}: {
  value: string[]
  disabled: boolean
  onChange: (value: string[]) => void
}) {
  function move(index: number, delta: number) {
    const next = [...value]
    ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
    onChange(next)
  }
  return (
    <section className="space-y-3">
      <h3>权益</h3>
      {value.map((text, i) => (
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`权益 ${i + 1}`}
            value={text}
            disabled={disabled}
            onChange={(event) =>
              onChange(value.map((item, index) => (index === i ? event.target.value : item)))
            }
          />
          <Button
            type="button"
            disabled={disabled || i === 0}
            onClick={() => move(i, -1)}
            aria-label={`上移权益 ${i + 1}`}
          >
            上移
          </Button>
          <Button
            type="button"
            disabled={disabled || i === value.length - 1}
            onClick={() => move(i, 1)}
            aria-label={`下移权益 ${i + 1}`}
          >
            下移
          </Button>
          <Button
            type="button"
            disabled={disabled}
            onClick={() => onChange(value.filter((_, index) => index !== i))}
            aria-label={`删除权益 ${i + 1}`}
          >
            删除
          </Button>
        </div>
      ))}
      <Button
        type="button"
        disabled={disabled || value.length >= 8}
        onClick={() => onChange([...value, ""])}
      >
        添加权益
      </Button>
    </section>
  )
}
