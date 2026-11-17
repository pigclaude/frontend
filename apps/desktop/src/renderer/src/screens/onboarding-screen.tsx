// 负责登录后的全屏新手引导：三步分屏、顶部进度、每步可跳过，随时「稍后再说」进入主界面。
import { isAccountProxyProtocol } from "@pigclaude/contracts/claude-account"
import { desktopText } from "../locale/text"
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
  onAddProxy: (input: { name: string; url: string }) => Promise<void>
  resume?: OnboardingState | undefined
}

const stepCopy: Record<OnboardingStep, { icon: string; title: string; why: string }> = {
  proxy: {
    icon: "globe",
    title: desktopText("flows.onboarding-screen.1"),
    why: desktopText("flows.onboarding-screen.2"),
  },
  account: {
    icon: "user",
    title: desktopText("flows.onboarding-screen.3"),
    why: desktopText("flows.onboarding-screen.4"),
  },
  session: {
    icon: "terminal",
    title: desktopText("flows.onboarding-screen.5"),
    why: desktopText("flows.onboarding-screen.6"),
  },
}

/** 画出整窗引导，不带侧栏。保证每一步都能跳过，后一步不因前一步跳过而锁定。 */
export function OnboardingScreen({
  onFinish,
  onOpenAuthorize,
  onAddProxy,
  resume,
}: OnboardingScreenProps) {
  const [state, setState] = useState(() => resume ?? createOnboardingState())
  const [proxyPending, setProxyPending] = useState(false)
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
        <Button
          className="wizard-cancel"
          variant="ghost"
          size="sm"
          onClick={onFinish}
          disabled={proxyPending}
        >
          {desktopText("flows.onboarding-screen.7")}
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
              {desktopText("flows.onboarding-screen.8")}
              {index + 1}
              {desktopText("flows.onboarding-screen.9")}
              {onboardingSteps.length}
              {desktopText("flows.onboarding-screen.10")}
            </p>
            <h1 id="onboarding-title" ref={heading} tabIndex={-1}>
              {copy.title}
            </h1>
            <p className="onboarding-why">{copy.why}</p>
            {state.step === "proxy" ? (
              <ProxyStep
                onAddProxy={onAddProxy}
                onPendingChange={setProxyPending}
                onAdded={() => advance({ type: "complete" })}
                onSkip={() => advance({ type: "skip" })}
              />
            ) : (
              <StepFoot onSkip={() => advance({ type: "skip" })}>
                {state.step === "account" ? (
                  <Button variant="primary" size="lg" onClick={() => onOpenAuthorize(state)}>
                    {desktopText("flows.onboarding-screen.11")}
                  </Button>
                ) : (
                  <Button variant="primary" size="lg" onClick={() => advance({ type: "complete" })}>
                    {desktopText("flows.onboarding-screen.12")}
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

/** 第 1 步：实际核对并保存代理，失败时保留当前输入。 */
function ProxyStep({
  onAddProxy,
  onPendingChange,
  onAdded,
  onSkip,
}: {
  onAddProxy: (input: { name: string; url: string }) => Promise<void>
  onPendingChange: (pending: boolean) => void
  onAdded: () => void
  onSkip: () => void
}) {
  const [address, setAddress] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const ready = address.trim() !== "" && !pending

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!ready || inFlight.current) return
    let name: string
    try {
      const parsed = new URL(address.trim())
      if (!isAccountProxyProtocol(parsed.protocol) || !parsed.host) throw new Error()
      name = parsed.host
    } catch {
      setError(desktopText("flows.onboarding-screen.13"))
      return
    }
    inFlight.current = true
    setPending(true)
    setError(null)
    onPendingChange(true)
    void onAddProxy({ name, url: address.trim() }).then(
      () => {
        inFlight.current = false
        setPending(false)
        onPendingChange(false)
        onAdded()
      },
      () => {
        inFlight.current = false
        setPending(false)
        onPendingChange(false)
        setError(desktopText("flows.onboarding-screen.14"))
      },
    )
  }

  return (
    <form className="onboarding-form" onSubmit={submit}>
      <Input
        className="mono"
        aria-label={desktopText("flows.onboarding-screen.15")}
        aria-describedby="onboarding-proxy-hint"
        placeholder="http://user:pass@host:8000"
        autoComplete="off"
        spellCheck={false}
        disabled={pending}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
      />
      <p className="onboarding-hint" id="onboarding-proxy-hint">
        {desktopText("flows.onboarding-screen.16")}
      </p>
      {error !== null && <p role="alert">{error}</p>}
      <StepFoot onSkip={onSkip} disabled={pending}>
        <Button variant="primary" size="lg" type="submit" disabled={!ready}>
          {pending
            ? desktopText("flows.onboarding-screen.17")
            : desktopText("flows.onboarding-screen.18")}
        </Button>
      </StepFoot>
    </form>
  )
}

/** 每步底部一行：左边「跳过」，右边这一步的主操作。 */
function StepFoot({
  onSkip,
  children,
  disabled = false,
}: {
  onSkip: () => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <div className="onboarding-foot">
      <Button variant="ghost" size="lg" type="button" onClick={onSkip} disabled={disabled}>
        {desktopText("flows.onboarding-screen.19")}
      </Button>
      {children}
    </div>
  )
}

/** 顶部三段进度：做完的、跳过的、当前和未到的各有一种样子，读屏念出每段状态。 */
function OnboardingProgress({ state }: { state: OnboardingState }) {
  const current = onboardingSteps.indexOf(state.step)
  return (
    <ol className="onboarding-progress" aria-label={desktopText("flows.onboarding-screen.20")}>
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
  current: desktopText("flows.onboarding-screen.21"),
  todo: desktopText("flows.onboarding-screen.22"),
  done: desktopText("flows.onboarding-screen.23"),
  skipped: desktopText("flows.onboarding-screen.24"),
} as const
