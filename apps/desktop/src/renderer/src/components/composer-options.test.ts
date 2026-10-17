// 验证会话输入区键盘行为的纯辅助函数。
import { describe, expect, it } from "vitest"
import { getComposerKeyAction } from "./composer-options"

describe("composer key actions", () => {
  it("Enter 提交，Shift+Enter 换行，其它按键忽略", () => {
    expect(getComposerKeyAction("Enter", false)).toBe("submit")
    expect(getComposerKeyAction("Enter", true)).toBe("newline")
    expect(getComposerKeyAction("Escape", false)).toBe("ignore")
  })
})
