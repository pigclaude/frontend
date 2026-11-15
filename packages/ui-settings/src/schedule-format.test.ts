// 从固定 Pigcode 提交提取 formatRule 测试组。
import { describe, expect, it } from "vitest"

import type { ScheduleRule } from "@pigclaude/ui-contracts"

import { translate } from "@pigclaude/ui-primitives"

import { formatRule } from "./schedule-format"

describe("formatRule", () => {
  const say = (rule: ScheduleRule) => formatRule(rule, (key) => translate("zh-CN", key), "zh-CN")
  const anchor = "2026-11-02T01:00:00.000Z"

  it("describes every kind of rule", () => {
    expect(say({ kind: "hourly", minute: 5 })).toBe("每小时的第 05 分")
    expect(say({ kind: "weekdays", time: "09:00" })).toBe("每工作日 09:00")
    expect(say({ kind: "weekly", days: [5, 1], time: "16:00" })).toBe("每周一、周五 16:00")
    expect(say({ kind: "monthly", day: 15, time: "10:00" })).toBe("每月 15 号 10:00")
    expect(say({ kind: "everyMinutes", every: 30, anchor })).toBe("每 30 分钟")
    expect(say({ kind: "everyHours", every: 2, minute: 15, anchor })).toBe("每 2 小时的第 15 分")
    expect(say({ kind: "everyDays", every: 3, time: "08:00", anchor })).toBe("每 3 天 08:00")
    expect(say({ kind: "everyWeeks", every: 2, days: [1, 4], time: "10:00", anchor })).toBe(
      "每 2 周的周一、周四，10:00",
    )
    expect(say({ kind: "everyMonths", every: 1, days: [1, 15], time: "09:00", anchor })).toBe(
      "每 1 个月的 1、15 号，09:00",
    )
    expect(say({ kind: "everyMonthsWeekday", every: 2, weekday: 1, time: "09:00", anchor })).toBe(
      "每 2 个月的第一个周一，09:00",
    )
    expect(say({ kind: "everyYears", every: 1, month: 3, day: 8, time: "09:00", anchor })).toBe(
      "每 1 年的3月8日，09:00",
    )
  })
})
