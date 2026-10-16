// 选号测试。用尽的账号会被跳过，全部不可用时返回空。

import { describe, expect, it } from "vitest"
import { selectAccount, type SwitchCandidate } from "./switcher.ts"

function account(patch: Partial<SwitchCandidate> & Pick<SwitchCandidate, "id">): SwitchCandidate {
  return {
    enabled: true,
    exhaustedUntil: null,
    fiveHour: { usedRatio: 0.1, resetsAt: "2026-10-17T05:00:00Z" },
    sevenDay: { usedRatio: 0.1, resetsAt: "2026-10-20T00:00:00Z" },
    ...patch,
  }
}

describe("selectAccount", () => {
  it("skips a spent account and returns the next one in order", () => {
    const selected = selectAccount({
      now: "2026-10-17T01:00:00Z",
      order: ["a", "b"],
      thresholds: { fiveHour: 1, sevenDay: 1 },
      accounts: [
        account({ id: "a", fiveHour: { usedRatio: 1, resetsAt: "2026-10-17T05:00:00Z" } }),
        account({ id: "b" }),
      ],
    })
    expect(selected).toBe("b")
  })

  it("returns null when every account is unavailable", () => {
    expect(
      selectAccount({
        now: "2026-10-17T01:00:00Z",
        order: ["a"],
        thresholds: { fiveHour: 1, sevenDay: 1 },
        accounts: [account({ id: "a", enabled: false })],
      }),
    ).toBeNull()
  })
})
