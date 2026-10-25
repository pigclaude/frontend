// 负责迁入原首页多列页脚、底栏与渐隐大字标的视觉结构。
import Link from "next/link"
import { BrandMark } from "@/components/brand-mark"
import { AccentPicker } from "@pigclaude/web-ui/components/accent-picker"
import { ThemeToggle } from "@/components/theme-toggle"

/** 只提供当前真实存在的产品和账户链接。 */
export function Footer() {
  return (
    <footer className="landing-footer">
      <div className="landing-container">
        <div className="landing-foot-grid">
          <div className="landing-foot-brand-col">
            <Link href="/" className="landing-foot-brand">
              <BrandMark className="size-6" tone="brand" />
              PigClaude
            </Link>
            <p className="landing-foot-tag">
              你的账户，你的权益，
              <br />
              每一次连接都清晰可靠。
            </p>
          </div>
          <div className="landing-foot-col">
            <h2>产品</h2>
            <ul>
              <li>
                <a href="/#product">了解 PigClaude</a>
              </li>
              <li>
                <a href="/#workflow">使用流程</a>
              </li>
              <li>
                <a href="/#pricing">会员权益</a>
              </li>
            </ul>
          </div>
          <div className="landing-foot-col">
            <h2>账户</h2>
            <ul>
              <li>
                <Link href="/login">登录</Link>
              </li>
              <li>
                <Link href="/register">创建账户</Link>
              </li>
              <li>
                <Link href="/account">个人中心</Link>
              </li>
            </ul>
          </div>
          <div className="landing-foot-col">
            <h2>设备</h2>
            <ul>
              <li>
                <Link href="/membership">会员与设备授权</Link>
              </li>
            </ul>
            <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
              从桌面客户端发起授权，
              <br />
              在网页中完成确认。
            </p>
          </div>
        </div>
        <div className="landing-foot-bar">
          <span>© {new Date().getFullYear()} PigClaude</span>
          <div className="landing-foot-toggles">
            <AccentPicker />
            <ThemeToggle />
          </div>
        </div>
        <div aria-hidden className="landing-wordmark">
          PigClaude
        </div>
      </div>
    </footer>
  )
}
