// 负责验证当前设备页面使用的脱敏显示，中央审批覆盖在authorization-page测试。
import { describe, expect, it } from "vitest"
import { maskDeviceValue } from "@/lib/device-mask"
describe("device display", () => {
  it("only exposes a masked device value in the UI helper", () => {
    expect(maskDeviceValue("device-super-secret-1234")).toBe("devi••••1234")
    expect(maskDeviceValue("tiny")).toBe("••••")
    expect(maskDeviceValue("device-super-secret-1234")).not.toContain("secret")
  })
})
