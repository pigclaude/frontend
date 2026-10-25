// 负责验证用户头像的图片显示、加载失败回退首字，以及按 ID 选色的稳定性和对比度。
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { AVATAR_COLORS, UserAvatar, avatarColor } from "@/components/account/user-avatar"

afterEach(cleanup)

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

describe("UserAvatar", () => {
  it("shows the provider picture when one is set", () => {
    render(
      <UserAvatar id="100001" nickname="林小猪" avatar="https://example.test/a.png" size={60} />,
    )
    const image = screen.getByRole("img", { name: "林小猪" })
    expect(image.tagName).toBe("IMG")
    expect(image.getAttribute("src")).toBe("https://example.test/a.png")
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer")
  })

  it("falls back to the first character when the image fails to load", () => {
    render(
      <UserAvatar id="100001" nickname="林小猪" avatar="https://example.test/a.png" size={60} />,
    )
    fireEvent.error(screen.getByRole("img", { name: "林小猪" }))
    expect(document.querySelector("img")).toBeNull()
    expect(screen.getByRole("img", { name: "林小猪" }).textContent).toBe("林")
  })

  it("never loads non-https addresses", () => {
    render(<UserAvatar id="100001" nickname="ada" avatar="http://example.test/a.png" size={30} />)
    expect(document.querySelector("img")).toBeNull()
    expect(screen.getByRole("img", { name: "ada" }).textContent).toBe("A")
  })

  it("keeps emoji and other multi-unit characters whole", () => {
    render(<UserAvatar id="100001" nickname="🐷猪猪" avatar="" size={36} />)
    expect(screen.getByRole("img", { name: "🐷猪猪" }).textContent).toBe("🐷")
  })

  it("picks a stable colour from the numeric id", () => {
    expect(avatarColor("100001")).toBe(avatarColor("100009"))
    expect(avatarColor("100001")).not.toBe(avatarColor("100002"))
    expect(avatarColor("not-a-number")).toBe(AVATAR_COLORS[0])
  })

  it("keeps white initials readable on every colour", () => {
    expect(AVATAR_COLORS).toHaveLength(8)
    for (const colour of AVATAR_COLORS) {
      expect(1.05 / (luminance(colour) + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
