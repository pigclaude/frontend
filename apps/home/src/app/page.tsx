// 负责按 Pigcursor 成熟官网结构呈现 PigClaude 的真实账户、会员和设备能力。
import Link from "next/link"
import { ArrowRight, Check, Fingerprint, Laptop, ShieldCheck, UserRound } from "lucide-react"
import { Button } from "@pigclaude/web-ui/components/button"
import { Nav } from "@/components/nav"
import { AccountPreview } from "@/components/landing/account-preview"
import { Footer } from "@/components/landing/footer"
import { Pricing } from "@/components/landing/pricing"

/** 迁入原首页的 Hero、透视舞台、Bento、套餐、步骤及页脚，不承诺未提供的功能。 */
export default function HomePage() {
  return (
    <>
      <Nav variant="marketing" />
      <main>
        <section id="product" className="landing-hero scroll-mt-16">
          <div aria-hidden className="landing-hero-dots" />
          <div aria-hidden className="landing-hero-glow" />
          <div className="landing-hero-copy">
            <span className="landing-pill">
              <span aria-hidden className="landing-pill-dot" />
              连接你的 PigClaude 桌面体验
            </span>
            <h1 className="landing-h1">
              <span className="block">让每一次连接，</span>
              <span className="landing-hero-ink block">都清晰、可靠。</span>
            </h1>
            <p className="landing-hero-sub">
              一个账户，管理你的会员权益与桌面设备。
              <br />
              在网页中确认授权，回到桌面继续使用。
            </p>
            <div className="landing-hero-ctas">
              <Button asChild size="lg" className="landing-cta landing-cta-primary">
                <Link href="/register">
                  创建账户
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="landing-cta">
                <Link href="/login">登录 / 注册</Link>
              </Button>
            </div>
            <p className="landing-hero-note">设备授权由桌面客户端发起，始终由你确认。</p>
          </div>
          <div className="landing-stage">
            <div className="landing-tilt">
              <div className="landing-window">
                <AccountPreview />
              </div>
            </div>
          </div>
          <div className="landing-stage-cap">
            <span>账户与设备能力预览 · 具体权益以账户实际状态为准</span>
            <a href="#workflow">
              了解使用流程
              <ArrowRight aria-hidden className="size-3.5" />
            </a>
          </div>
        </section>
        <section id="workflow" className="landing-section scroll-mt-16">
          <div className="landing-container">
            <div className="landing-head">
              <div>
                <span className="landing-eyebrow">
                  <span className="landing-eyebrow-nos" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  从账户到桌面
                </span>
                <h2 className="landing-h2">
                  简单连接，
                  <br />
                  每一步都心中有数。
                </h2>
              </div>
              <p className="landing-lede">
                账户、会员、设备各有清晰的状态。登录后查看权益，从桌面发起授权，在网页确认后继续使用。
              </p>
            </div>
            <div className="landing-bento">
              <article className="landing-cell landing-cell-tall">
                <h3>你的权益，一处查看。</h3>
                <p>会员是否有效、有效期到何时，都可以在账户中随时确认。</p>
                <div className="landing-cell-ui is-inset">
                  <div className="home-card mt-4">
                    <div className="feature-art">
                      <ShieldCheck className="size-20" strokeWidth={1} />
                    </div>
                    <h4 className="text-lg font-semibold">会员与账户相连</h4>
                    <div className="data-list mt-4">
                      <div>
                        <dt>权益状态</dt>
                        <dd>实时查看</dd>
                      </div>
                      <div>
                        <dt>有效期限</dt>
                        <dd>清晰展示</dd>
                      </div>
                      <div>
                        <dt>桌面授权</dt>
                        <dd>由你确认</dd>
                      </div>
                    </div>
                    <p className="muted">有效会员可确认桌面客户端发起的设备授权。</p>
                  </div>
                </div>
              </article>
              <article className="landing-cell">
                <h3>登录账户，连接桌面。</h3>
                <p>在熟悉的浏览器中登录，授权完成后回到桌面继续。</p>
                <div className="landing-cell-ui is-inset">
                  <div className="feature-art">
                    <div className="flex items-center gap-6 rounded-2xl border border-border bg-[var(--raise-1)] p-8">
                      <UserRound className="size-10" strokeWidth={1.3} />
                      <ArrowRight className="size-5 text-[var(--meta)]" />
                      <Laptop className="size-12" strokeWidth={1.3} />
                    </div>
                  </div>
                </div>
              </article>
              <article className="landing-cell">
                <h3>设备替换，明确确认。</h3>
                <p>已有设备绑定时，只有你再次确认，才会完成替换。</p>
                <div className="landing-cell-ui is-inset">
                  <div className="feature-art">
                    <div className="flex w-full items-center gap-4 rounded-xl border border-border bg-[var(--raise-1)] p-6">
                      <Fingerprint className="size-10 shrink-0" strokeWidth={1.2} />
                      <div>
                        <strong className="text-sm font-medium text-foreground">
                          每一次授权都由你决定
                        </strong>
                        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                          <Check className="size-3.5" />
                          设备信息安全展示
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>
        <Pricing />
        <section className="landing-section">
          <div className="landing-container">
            <div className="landing-final">
              <div className="landing-final-grid">
                <div>
                  <span className="landing-eyebrow">开始使用</span>
                  <h2 className="landing-h2 landing-final-title">
                    准备好，
                    <br />
                    连接你的桌面。
                  </h2>
                  <p className="landing-lede landing-final-desc">
                    从创建账户开始，只需几步，就能完成你的设备授权。
                  </p>
                  <Button asChild size="lg" className="mt-8 landing-cta landing-cta-primary">
                    <Link href="/register">
                      创建账户
                      <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  </Button>
                </div>
                <ol className="landing-steps">
                  {[
                    {
                      title: "创建或登录账户",
                      description: "使用邮箱登录 PigClaude，集中管理账户和会员。",
                    },
                    {
                      title: "确认会员权益",
                      description: "查看当前权益状态和有效期限，确保会员有效。",
                    },
                    {
                      title: "从桌面发起授权",
                      description: "打开桌面客户端给出的授权链接，核对设备并确认授权。",
                    },
                  ].map((step, index) => (
                    <li key={step.title}>
                      <span className="landing-step-n">{index + 1}</span>
                      <div>
                        <h3>{step.title}</h3>
                        <p>{step.description}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
