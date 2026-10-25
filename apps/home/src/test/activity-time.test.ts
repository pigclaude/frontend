// 负责验证设备与网页登录的活跃时间文案在各个时间段的边界。
import { describe, expect, it } from "vitest"
import { formatActivity } from "@/lib/activity-time"

// 用本地时间构造，避免测试结果依赖运行机器的时区。
const at = (month: number, day: number, hour: number, minute = 0) =>
  new Date(2026, month - 1, day, hour, minute).toISOString()
const now = new Date(2026, 9, 24, 12, 0)

describe("formatActivity", () => {
  it("treats the last five minutes as in use", () => {
    expect(formatActivity(at(10, 24, 11, 57), now)).toMatchObject({
      label: "正在使用",
      active: true,
    })
    expect(formatActivity(at(10, 24, 11, 55), now)).toMatchObject({
      label: "5 分钟前活跃",
      active: false,
    })
  })

  it("counts minutes within the hour and hours within the same day", () => {
    expect(formatActivity(at(10, 24, 11, 20), now).label).toBe("40 分钟前活跃")
    expect(formatActivity(at(10, 24, 8), now).label).toBe("4 小时前活跃")
    expect(formatActivity(at(10, 24, 0, 30), now).label).toBe("11 小时前活跃")
  })

  it("uses 昨天 for the previous calendar day even within 24 hours", () => {
    expect(formatActivity(at(10, 23, 22), now).label).toBe("昨天活跃")
    expect(formatActivity(at(10, 23, 0, 5), now).label).toBe("昨天活跃")
  })

  it("counts calendar days up to thirty and then shows the date", () => {
    expect(formatActivity(at(10, 21, 12), now).label).toBe("3 天前活跃")
    expect(formatActivity(at(9, 24, 12), now).label).toBe("30 天前活跃")
    expect(formatActivity(at(9, 1, 12), now).label).toBe("9 月 1 日活跃")
  })

  it("exposes the full local time for hover", () => {
    expect(formatActivity(at(9, 1, 12), now).title).toBe("2026/09/01 12:00")
    expect(formatActivity(at(10, 24, 9, 5), now).title).toBe("2026/10/24 09:05")
  })

  it("does not claim a future or unreadable time is old", () => {
    expect(formatActivity(at(10, 24, 12, 3), now)).toMatchObject({
      label: "正在使用",
      active: true,
    })
    expect(formatActivity("not-a-date", now)).toEqual({ label: "", active: false, title: "" })
  })
})
