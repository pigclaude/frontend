// 负责等级表单的精确单位转换和请求白名单，不计算展示金额。
import type { Tier, TierInput, OptionInput, CardStyle } from "@pigclaude/api/membership/types"
/** 表单中的数值保留原始文本，避免浮点和输入中间态丢失。 */
export interface TierDraft {
  code: string
  name: string
  level: string
  monthlyPrice: string
  tagline: string
  cardStyle: CardStyle
  benefits: string[]
  enabled: boolean
  options: {
    id?: string
    months: string
    discountKind: OptionInput["discountKind"]
    badge: string | null
    recommended: boolean
    value: string
    enabled: boolean
  }[]
}
/** 将非负定点输入转换为整数字符串，拒绝隐式舍入和科学记数法。 */
export function parseUnits(value: string, places: number): string {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(value))
    throw new Error("请输入有效数字，不支持超出精度的小数")
  const [whole, fraction = ""] = value.split(".")
  return (whole + fraction.padEnd(places, "0")).replace(/^0+(?=\d)/, "")
}
function displayUnits(value: string, places: number) {
  const digits = value.padStart(places + 1, "0")
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`
}
function integer(value: string) {
  if (!/^\d+$/.test(value)) throw new Error("等级和月数必须为正整数")
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1 || result > 2147483647)
    throw new Error("等级和月数超出范围")
  return result
}
/** 保留已有档位标识，预览响应不能进入编辑状态。 */
export function draftFromTier(tier: Tier | null): TierDraft {
  return tier
    ? {
        code: tier.code,
        name: tier.name,
        level: String(tier.level),
        monthlyPrice: displayUnits(tier.monthlyPriceFen, 2),
        tagline: tier.tagline,
        cardStyle: tier.cardStyle,
        benefits: [...tier.benefits],
        enabled: tier.enabled,
        options: tier.options.map((o) => ({
          id: o.id,
          badge: o.badge,
          recommended: o.recommended,
          months: String(o.months),
          discountKind: o.discountKind,
          value:
            o.discountKind === "none"
              ? "0"
              : displayUnits(o.discountValue, o.discountKind === "amount" ? 2 : 3),
          enabled: o.enabled,
        })),
      }
    : {
        code: "",
        name: "",
        level: "1",
        monthlyPrice: "",
        tagline: "",
        cardStyle: "azure",
        benefits: [],
        enabled: true,
        options: [
          {
            months: "1",
            discountKind: "none",
            value: "0",
            badge: null,
            recommended: false,
            enabled: true,
          },
        ],
      }
}
/** 预览总是携带已知 code；保存已有等级时调用方显式省略。 */
export function tierInput(draft: TierDraft): TierInput & { code: string } {
  if (!draft.name.trim() || !draft.code.trim()) throw new Error("请填写名称和代号")
  if ([...draft.tagline].length > 24) throw new Error("标语最多 24 个字符")
  if (
    draft.benefits.length > 8 ||
    draft.benefits.some((benefit) => {
      const length = [...benefit.trim()].length
      return length < 1 || length > 24
    })
  )
    throw new Error("权益最多 8 条，每条需为 1–24 个字符")
  if (
    draft.options.some(
      (option) =>
        option.badge !== null &&
        ([...option.badge.trim()].length < 1 || [...option.badge.trim()].length > 6),
    )
  )
    throw new Error("档位角标需为 1–6 个字符")
  if (draft.options.filter((option) => option.recommended).length > 1)
    throw new Error("每个等级最多一个推荐档位")
  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    level: integer(draft.level),
    monthlyPriceFen: parseUnits(draft.monthlyPrice, 2),
    tagline: draft.tagline,
    cardStyle: draft.cardStyle,
    benefits: [...draft.benefits],
    enabled: draft.enabled,
    options: draft.options.map((o) => ({
      ...(o.id ? { id: o.id } : {}),
      badge: o.badge,
      recommended: o.recommended,
      months: integer(o.months),
      discountKind: o.discountKind,
      discountValue:
        o.discountKind === "none" ? "0" : parseUnits(o.value, o.discountKind === "amount" ? 2 : 3),
      enabled: o.enabled,
    })),
  }
}
