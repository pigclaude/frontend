// 负责验证常用指纹选项的校验兼容、系统版本分组和种子生成边界。

import { describe, expect, it } from "vitest"
import {
  defaultFingerprintForm,
  fingerprintFieldMeta,
  validateFingerprintForm,
} from "./fingerprint-form"
import {
  fingerprintChoiceKeys,
  fingerprintChoices,
  generateFingerprintSeed,
} from "./fingerprint-choices"

describe("fingerprint choices", () => {
  it("provides choices for every editable text field except custom dimensions and raw arguments", () => {
    const keys = Object.entries(fingerprintFieldMeta)
      .filter(([, field]) => field.control === "choice")
      .map(([key]) => key)
    expect(keys.sort()).toEqual([...fingerprintChoiceKeys].sort())
  })

  it("keeps every offered value valid at the existing submission boundary", () => {
    for (const platform of ["macos", "windows", "linux", ""]) {
      const base = { ...defaultFingerprintForm(), platform }
      for (const key of fingerprintChoiceKeys) {
        const choices = fingerprintChoices(key, base)
        expect(new Set(choices.map((item) => item.value)).size).toBe(choices.length)
        for (const option of choices) {
          expect(
            validateFingerprintForm({ ...base, [key]: option.value })[key],
            `${key}: ${option.value}`,
          ).toBeUndefined()
        }
      }
    }
  })

  it("offers versions for the selected platform without changing the stored draft", () => {
    const draft = {
      ...defaultFingerprintForm(),
      platform: "linux",
      platformVersion: "custom-version",
    }
    expect(fingerprintChoices("platformVersion", draft).map((item) => item.value)).toContain(
      "6.8.0",
    )
    expect(fingerprintChoices("platformVersion", draft).map((item) => item.value)).not.toContain(
      "15.2.0",
    )
    expect(draft.platformVersion).toBe("custom-version")
  })

  it("generates integers accepted by the fingerprint validator", () => {
    for (let index = 0; index < 20; index++) {
      const seed = generateFingerprintSeed()
      expect(seed).toMatch(/^\d+$/)
      expect(validateFingerprintForm({ ...defaultFingerprintForm(), seed }).seed).toBeUndefined()
    }
  })
})
