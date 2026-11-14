// 本机运行时测试共用的装配：临时账号库、假会员、可记录的假 daemon 或接到本机假上游的真实 daemon，
// 以及账号、凭据和代理记录的构造。不访问网络之外的真实服务。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { LocalDaemon } from "@pigclaude/daemon"
import {
  LocalStore,
  type AccountRecord,
  type ClaudeCredential,
  type IpProxy,
} from "@pigclaude/local-store"
import { membershipView } from "../testing/profile-fixture"
import { AccountChooser } from "./account-chooser"
import { LocalRuntime, type LocalDaemonHandle, type LocalDaemonOptions } from "./local-runtime"

/** 运行时测试的固定当前时间；凭据有效期和冷却时间都按它计算。 */
export const now = Date.parse("2026-10-26T00:00:00.000Z")

/** 记下构造参数、可模拟意外退出的假 daemon。 */
export type FakeDaemon = LocalDaemonHandle & {
  options: LocalDaemonOptions
  started: boolean
  stopped: boolean
  exit: () => void
}

/** 可以手动广播状态变化的假会员。 */
export type FakeMembership = {
  view: () => MembershipView
  subscribe: (listener: (view: MembershipView) => void) => () => void
  publish: (state: MembershipView["state"]) => void
}

/** 一个装好的运行时和它的依赖；cleanup 释放运行时并删除临时目录。 */
export type Harness = {
  runtime: LocalRuntime
  store: LocalStore
  membership: FakeMembership
  daemons: FakeDaemon[]
  sleeps: number[]
  cleanup: () => Promise<void>
}

/** 装配选项；realDaemon 用真实 LocalDaemon，upstreamOrigin 再把它的上游换成本机假服务。 */
export type HarnessOptions = {
  state?: MembershipView["state"]
  accounts?: AccountRecord[]
  proxies?: IpProxy[]
  now?: () => number
  startFailures?: number
  backoffMs?: readonly number[]
  quotaCooldownMs?: number
  realDaemon?: boolean
  upstreamOrigin?: URL
}

/** 用临时目录里的真实账号库和真实选号器装配运行时。 */
export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "local-runtime-"))
  const store = new LocalStore(dir)
  for (const item of options.proxies ?? []) await store.saveProxy(item)
  for (const item of options.accounts ?? []) await store.saveAccount(item)
  const membership = fakeMembership(options.state ?? "active")
  const chooser = new AccountChooser({
    store,
    refresher: { refreshIfNeeded: async (record) => record },
    now: options.now ?? (() => now),
  })
  const daemons: FakeDaemon[] = []
  const sleeps: number[] = []
  let startFailures = options.startFailures ?? 0
  const createDaemon = (daemonOptions: LocalDaemonOptions): LocalDaemonHandle => {
    const fail = startFailures > 0
    if (fail) startFailures -= 1
    const daemon: FakeDaemon = {
      port: 42000 + daemons.length,
      options: daemonOptions,
      started: false,
      stopped: false,
      start: async () => {
        if (fail) throw new Error("listen failed")
        daemon.started = true
      },
      stop: async () => {
        daemon.stopped = true
      },
      exit: () => daemonOptions.onExit(),
    }
    daemons.push(daemon)
    return daemon
  }
  const upstreamOrigin = options.upstreamOrigin
  const runtime = new LocalRuntime({
    store,
    chooser,
    membership,
    runAuthorized: async (operation) => operation(new AbortController().signal),
    now: options.now ?? (() => now),
    backoffMs: options.backoffMs,
    quotaCooldownMs: options.quotaCooldownMs,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    ...(upstreamOrigin === undefined
      ? options.realDaemon
        ? {}
        : { createDaemon }
      : { createDaemon: (input) => new LocalDaemon({ ...input, upstreamOrigin }) }),
  })
  return {
    runtime,
    store,
    membership,
    daemons,
    sleeps,
    cleanup: async () => {
      await runtime.dispose()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** 构造一个已授权、启用、未冷却的账号；默认绑定代理 p1，语言时区是 en-US 和洛杉矶。 */
export function account(id: string, overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    enabled: true,
    credential: credentialFor(id),
    needsReauth: false,
    proxyId: "p1",
    fingerprint: {
      seed: "123456",
      brand: "Chrome",
      platform: "macos",
      lang: "en-US",
      timezone: "America/Los_Angeles",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
    browserProfileDir: `/tmp/browser-profiles/${id}`,
    exhaustedUntil: null,
    createdAt: "2026-10-26T00:00:00.000Z",
    updatedAt: "2026-10-26T00:00:00.000Z",
    ...overrides,
  }
}

/** 构造一个指向不可达测试域名的代理记录。 */
export function proxy(id: string): IpProxy {
  return { schemaVersion: 1, id, name: id, url: `http://${id}.test:8080`, lastTest: null }
}

function credentialFor(id: string): ClaudeCredential {
  return {
    schemaVersion: 1,
    accessToken: `token-${id}`,
    refreshToken: `refresh-${id}`,
    expiresAt: now + 60 * 60 * 1_000,
    scopes: ["user:inference"],
    accountUuid: `uuid-${id}`,
    email: `${id}@example.com`,
    organizationUuid: "org",
    subscriptionType: "max",
    rateLimitTier: null,
  }
}

function fakeMembership(state: MembershipView["state"]): FakeMembership {
  let current = membershipView(state)
  const listeners = new Set<(view: MembershipView) => void>()
  return {
    view: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish: (next) => {
      current = membershipView(next)
      for (const listener of [...listeners]) listener(current)
    },
  }
}
