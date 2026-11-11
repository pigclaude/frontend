// 负责沿用原首页的价格分区，从真实套餐查询呈现价格与重试状态。
"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ApiError } from "@pigclaude/api/client"
import { MembershipCard, MembershipCardGroup } from "@pigclaude/web-ui/components/membership-card"
import { DurationCard } from "@pigclaude/web-ui/components/duration-card"
import { BenefitGrid } from "@pigclaude/web-ui/components/benefit-grid"
import { formatFen } from "@pigclaude/web-ui/lib/format"
import { useQuery } from "@tanstack/react-query"
import { homeSessionGeneration } from "@/lib/session-generation"
import { homeApi } from "@/lib/api"
import { QueryEmpty, QueryError, QueryLoading } from "@/components/query-state"

/** 让公开首页与会员页共享真实套餐缓存和精确价格展示。 */
export function Pricing() {
  const router = useRouter()
  const mounted = useRef(false)
  const request = useRef(0)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      request.current += 1
    }
  }, [])
  const [selected, setSelected] = useState<string | null>(null)
  const [navigationError, setNavigationError] = useState<{ error: unknown; target: string } | null>(
    null,
  )
  const [pending, setPending] = useState(false)
  const plans = useQuery({ queryKey: ["membership-catalog"], queryFn: homeApi.membership.catalog })
  const tiers = plans.data?.tiers.toSorted((a, b) => a.level - b.level) ?? []
  const tier = tiers.find((item) => item.code === selected) ?? tiers[0]
  const navigate = async (target: string) => {
    const id = ++request.current
    const session = homeSessionGeneration.current()
    const latest = () => mounted.current && id === request.current
    const current = () => latest() && session === homeSessionGeneration.current()
    setPending(true)
    setNavigationError(null)
    try {
      await homeApi.user.me()
      if (current()) router.push(target)
    } catch (error) {
      if (!current()) return
      if (error instanceof ApiError && error.status === 401)
        router.push(`/login?redirect=${encodeURIComponent(target)}`)
      else setNavigationError({ error, target })
    } finally {
      if (latest()) setPending(false)
    }
  }
  return (
    <section id="pricing" className="landing-section scroll-mt-16">
      <div className="landing-container">
        <div className="landing-pricing-head">
          <span className="landing-eyebrow">会员权益</span>
          <h2 className="landing-h2">选择适合你的使用节奏。</h2>
          <p className="landing-lede">从短期体验到长期使用，会员权益始终与你的账户相连。</p>
        </div>
        <div className="mt-14">
          {plans.isPending ? (
            <QueryLoading label="正在读取套餐…" />
          ) : plans.isError ? (
            <QueryError error={plans.error} onRetry={() => void plans.refetch()} />
          ) : (
            <>
              <MembershipCardGroup label="会员等级">
                {tiers.map((item) => (
                  <MembershipCard
                    key={item.code}
                    name={item.name}
                    cardStyle={item.cardStyle}
                    tagline={item.tagline}
                    price={`${formatFen(item.monthlyPriceFen)}/月`}
                    selected={tier?.code === item.code}
                    onSelect={() => setSelected(item.code)}
                  />
                ))}
              </MembershipCardGroup>
              {tier ? (
                <>
                  <div className="mt-6 grid gap-4 sm:grid-cols-3" aria-label="购买时长">
                    {tier.options.map((option) => (
                      <DurationCard
                        key={option.id}
                        {...option}
                        navigation
                        selected={false}
                        disabled={pending}
                        onSelect={() =>
                          void navigate(
                            `/membership?tier=${encodeURIComponent(tier.code)}&option=${encodeURIComponent(option.id)}`,
                          )
                        }
                      />
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">1 个月按 30 天计</p>
                  <BenefitGrid items={tier.benefits} />
                </>
              ) : (
                <QueryEmpty label="暂无可用套餐" />
              )}
              {navigationError && (
                <QueryError
                  error={navigationError.error}
                  onRetry={() => void navigate(navigationError.target)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
