// 负责验证跨语言 fixture 的完整 JSON、可空字段、decimal string 和秘密字段边界。

import canonicalFixtures from "./phase1-contract-fixtures.json"
import { membershipFixture, phase1ContractFixtures } from "./phase1-contract-fixtures"
import { describe, expect, it } from "vitest"

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys)
  if (value === null || typeof value !== "object") return []
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)])
}

describe("phase1 contract fixtures", () => {
  it("matches the checked-in canonical JSON exactly", () => {
    expect(phase1ContractFixtures).toEqual(canonicalFixtures)
    expect(membershipFixture).toEqual(canonicalFixtures.membership)
  })

  it("keeps nullable and decimal string fields explicit", () => {
    expect(membershipFixture.membershipValidUntil).toBeNull()
    expect(membershipFixture.bindingEpoch).toMatch(/^\d+$/)
  })

  it("contains no secret or credential fields", () => {
    const forbidden = /token|secret|password|privatekey|credential/i
    expect(collectKeys(canonicalFixtures).some((key) => forbidden.test(key))).toBe(false)
  })
})
