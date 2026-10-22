// 负责提供本文件的前端契约、组件或样式实现。
import { describe, it, expect } from "vitest"
import {
  formatBytes,
  formatFen,
  formatFenSigned,
  formatMicroUsd,
  formatUsdtMicro,
  formatTime,
  formatTimeShanghai,
  toNumber,
} from "./format"

describe("formatFen", () => {
  it("分 → ¥千分位两位小数", () => {
    expect(formatFen(128650)).toBe("¥1,286.50")
    expect(formatFen("128650")).toBe("¥1,286.50") // int64 JSON string 直接可用
    expect(formatFen(0)).toBe("¥0.00")
    expect(formatFen("320")).toBe("¥3.20")
    // 大额 int64(> Number.MAX_SAFE_INTEGER)不丢精度:9007199254740993 分 → …09.93,
    // 而经 Number 会被舍成 …92 → …09.92。BigInt 定点保精度。
    expect(formatFen("9007199254740993")).toBe("¥90,071,992,547,409.93")
    expect(formatFenSigned("-9007199254740993")).toBe("−¥90,071,992,547,409.93")
  })
})

describe("formatFenSigned", () => {
  it("正 + / 负 −(U+2212) / 0 无符号", () => {
    expect(formatFenSigned("50000")).toBe("+¥500.00")
    expect(formatFenSigned("-320")).toBe("−¥3.20")
    expect(formatFenSigned(0)).toBe("¥0.00")
  })
})

describe("formatUsdtMicro", () => {
  it("微USDT → 两位小数", () => {
    expect(formatUsdtMicro("7130000")).toBe("7.13 USDT")
  })
})

describe("formatBytes", () => {
  it("字节（int64 JSON string 或 number）→ 友好可读串（1 位小数 + KB/MB/GB）", () => {
    expect(formatBytes("123456")).toBe("120.6 KB")
    expect(formatBytes(123456789)).toBe("117.7 MB")
    expect(formatBytes("2147483648")).toBe("2.0 GB")
  })
  it('<1024 保留整数 B；0 → "0 B"', () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes("512")).toBe("512 B")
  })
  it('非法/负值 → "—"', () => {
    expect(formatBytes("abc")).toBe("—")
    expect(formatBytes(-1)).toBe("—")
  })
})

describe("formatTime", () => {
  it("YYYY-MM-DD HH:mm 本地时区无秒", () => {
    expect(formatTime(new Date(2026, 6, 12, 14, 2, 33))).toBe("2026-07-12 14:02")
  })
  it("接受 RFC3339 字符串", () => {
    const d = new Date(2026, 0, 5, 9, 8)
    expect(formatTime(d.toISOString())).toBe("2026-01-05 09:08")
  })
})

describe("formatTimeShanghai", () => {
  it("评审 R30 F2：非 UTC+8 浏览器时区下也显示上海时间（UTC+8 固定偏移,与运行环境时区无关）", () => {
    // 2026-08-03T04:00:00Z = 上海 12:00——无论本机时区(UTC/UTC+9/…),恒显示 2026-08-03 12:00。
    expect(formatTimeShanghai("2026-08-03T04:00:00Z")).toBe("2026-08-03 12:00")
    expect(formatTimeShanghai(new Date("2026-08-03T04:00:00Z"))).toBe("2026-08-03 12:00")
  })

  it("评审 R30 F2：上海跨日边界正确进位（UTC 晚 16:00 = 上海次日 00:00）", () => {
    expect(formatTimeShanghai("2026-08-03T16:00:00Z")).toBe("2026-08-04 00:00")
  })

  it("评审 R30 F2：负偏移时区示例（UTC 20:00 仍是上海次日 04:00）", () => {
    expect(formatTimeShanghai("2026-08-03T20:00:00Z")).toBe("2026-08-04 04:00")
  })
})

describe("toNumber", () => {
  it("int64 string → number", () => {
    expect(toNumber("128650")).toBe(128650)
    expect(toNumber(5)).toBe(5)
  })
})

describe("formatMicroUsd", () => {
  it("微USD → 美元，保留亚分精度（最多 4 位、至少 2 位）", () => {
    expect(formatMicroUsd("3500000")).toBe("3.50 USD")
    expect(formatMicroUsd("35000")).toBe("0.035 USD")
    expect(formatMicroUsd(0)).toBe("0.00 USD")
  })
})

it("formats integer seconds without rounding into a longer duration", async () => {
  const { formatDurationSeconds } = await import("./format")
  expect(formatDurationSeconds("1047600")).toBe("12 天 3 小时")
  expect(formatDurationSeconds(3599)).toBe("0 天 0 小时")
  expect(formatDurationSeconds("9007199254740993")).toBe("104249991374 天 7 小时")
})
