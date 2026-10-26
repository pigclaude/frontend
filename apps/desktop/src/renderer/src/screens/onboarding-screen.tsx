// 负责登录后的全屏新手引导：三步分屏、顶部进度、每步可跳过，随时「稍后再说」进入主界面。
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Icon } from "../components/icon"
import { TrafficLights } from "../components/traffic-lights"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import {
  createOnboardingState,
  onboardingSteps,
  reduceOnboarding,
  type OnboardingEvent,
  type OnboardingState,
  type OnboardingStep,
} from "../models/onboarding-model"

/** 新手引导 props。onFinish 在做完最后一步或点「稍后再说」时调用；onOpenAuthorize 交出离开时的进度，resume 让引导带着这份进度继续。 */
export type OnboardingScreenProps = {
  onFinish: () => void
  onOpenAuthorize: (state: OnboardingState) => void
  resume?: OnboardingState
}

const stepCopy: Record<OnboardingStep, { icon: string; title: string; why: string }> = {
  proxy: {
    icon: "globe",
    title: "添加一个代理（可选）",
    why: "代理可选：未绑定代理的账号使用系统网络；已绑定代理的请求不会直连，避免账号被风控。",
  },
  account: {
    icon: "user",
    title: "添加 Claude 账号",
    why: "在外部浏览器里走 Claude 官方登录。绑定代理时出口和代理一致才会继续；不绑定则使用系统网络。",
  },
  session: {
    icon: "terminal",
    title: "开始第一个会话",
    why: "会话在独立目录里运行，不读你的 ~/.claude/settings.json。",
  },
}

/** 画出整窗引导，不带侧栏。保证每一步都能跳过，后一步不因前一步跳过而锁定。 */
export function OnboardingScreen({ onFinish, onOpenAuthorize, resume }: OnboardingScreenProps) {
  const [state, setState] = useState(() => resume ?? createOnboardingState())
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(resume !== undefined)
  const index = onboardingSteps.indexOf(state.step)
  const copy = stepCopy[state.step]

  useEffect(() => {
    if (moved.current) heading.current?.focus({ preventScroll: true })
  }, [state.step])

  function advance(event: OnboardingEvent): void {
    const next = reduceOnboarding(state, event)
    if (next === "finished") {
      onFinish()
      return
    }
    moved.current = true
    setState(next)
  }

  return (
    <div className="win onboarding" data-screen="onboarding">
      <div className="win-top">
        <TrafficLights />
        <Button className="wizard-cancel" variant="ghost" size="sm" onClick={onFinish}>
          稍后再说
        </Button>
      </div>
      <main className="win-body">
        <section className="onboarding-card" aria-labelledby="onboarding-title">
          <OnboardingProgress state={state} />
          <div className="onboarding-step" key={state.step}>
            <div className="onboarding-mark" aria-hidden="true">
              <Icon name={copy.icon} />
            </div>
            <p className="onboarding-count">
              第 {index + 1} 步，共 {onboardingSteps.length} 步
            </p>
            <h1 id="onboarding-title" ref={heading} tabIndex={-1}>
              {copy.title}
            </h1>
            <p className="onboarding-why">{copy.why}</p>
            {state.step === "proxy" ? (
              <ProxyStep
                onAdded={() => advance({ type: "complete" })}
                onSkip={() => advance({ type: "skip" })}
              />
            ) : (
              <StepFoot onSkip={() => advance({ type: "skip" })}>
                {state.step === "account" ? (
                  <Button variant="primary" size="lg" onClick={() => onOpenAuthorize(state)}>
                    添加账号
                  </Button>
                ) : (
                  <Button variant="primary" size="lg" onClick={() => advance({ type: "complete" })}>
                    开始第一个会话
                    <Icon name="arrow" />
                  </Button>
                )}
              </StepFoot>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

/** 第 1 步：代理地址输入和「测试并添加」。目前只是界面层假行为，按下即视为添加成功。 */
function ProxyStep({ onAdded, onSkip }: { onAdded: () => void; onSkip: () => void }) {
  const [address, setAddress] = useState("")
  const ready = address.trim() !== ""

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (ready) onAdded()
  }

  return (
    <form className="onboarding-form" onSubmit={submit}>
      <Input
        className="mono"
        aria-label="代理地址"
        aria-describedby="onboarding-proxy-hint"
        placeholder="http://user:pass@host:8000"
        autoComplete="off"
        spellCheck={false}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
      />
      <p className="onboarding-hint" id="onboarding-proxy-hint">
        支持 http、https、socks5，添加前会先测试一次；也可以跳过，让账号使用系统网络
      </p>
      <StepFoot onSkip={onSkip}>
        <Button variant="primary" size="lg" type="submit" disabled={!ready}>
          测试并添加
        </Button>
      </StepFoot>
    </form>
  )
}

/** 每步底部一行：左边「跳过」，右边这一步的主操作。 */
function StepFoot({ onSkip, children }: { onSkip: () => void; children: ReactNode }) {
  return (
    <div className="onboarding-foot">
      <Button variant="ghost" size="lg" type="button" onClick={onSkip}>
        跳过
      </Button>
      {children}
    </div>
  )
}

/** 顶部三段进度：做完的、跳过的、当前和未到的各有一种样子，读屏念出每段状态。 */
function OnboardingProgress({ state }: { state: OnboardingState }) {
  const current = onboardingSteps.indexOf(state.step)
  return (
    <ol className="onboarding-progress" aria-label="引导进度">
      {onboardingSteps.map((step, index) => {
        const status =
          index === current
            ? "current"
            : index > current
              ? "todo"
              : state.done[step]
                ? "done"
                : "skipped"
        return (
          <li
            key={step}
            data-state={status}
            aria-current={status === "current" ? "step" : undefined}
          >
            <span className="sr-only">
              {stepCopy[step].title}：{progressLabel[status]}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

const progressLabel = {
  current: "当前步骤",
  todo: "未开始",
  done: "已完成",
  skipped: "已跳过",
} as const
