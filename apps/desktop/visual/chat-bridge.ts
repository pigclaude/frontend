// 负责聊天时间线视觉用例共用的内存桌面桥：一个最近工作区、一个账号和一个按信封推送事件的假会话。
// 用例先装这座桥，再在自己的页面脚本里用 window.__chatBridge 推事件、换掉 send 等会话命令。
import type { Page } from "@playwright/test"

/** 推给页面的一条会话事件；字段按会话宿主的事件类型，这里不逐一声明。 */
export type BridgeEvent = { type: string; [field: string]: unknown }

/** 页面里的桥：emit 推一条 s-1 的信封（delta 不编号），assistant 构造一条主线程消息，install 装上桌面桥。 */
export type ChatBridge = {
  emit: (event: BridgeEvent) => void
  assistant: (id: string, blocks: unknown[], extra?: object) => { type: string }
  /** session 里的命令覆盖默认的会话命令；其他命令都是空操作。 */
  install: (session: Record<string, unknown>) => void
}

/** 在用例页面脚本里取桥的写法：(window as unknown as ChatBridgeWindow).__chatBridge。 */
export type ChatBridgeWindow = { __chatBridge: ChatBridge }

/** 页面加载前装好 window.__chatBridge；要在用例自己的页面脚本之前调用。 */
export async function installChatBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const membership = {
      startupPhase: "settled",
      revision: 1,
      state: "active",
      account: { userId: "u1", nickname: "林舟", email: "lin@example.com", avatar: "" },
      tier: null,
      membershipValidUntil: null,
      offlineValidUntil: null,
    }
    const reject = async () => {
      throw new Error("not used in the visual preview")
    }
    const account = {
      id: "acc-work",
      displayName: "工作号",
      enabled: true,
      email: null,
      subscriptionType: "max",
      needsReauth: false,
      credentialExpiresAt: 1_900_000_000_000,
      proxyId: null,
      fingerprint: {
        seed: "123456",
        brand: "Chrome",
        platform: "macos",
        lang: "en-US",
        timezone: "America/Los_Angeles",
        canvasNoise: "1",
        clientRectsNoise: "1",
      },
      createdAt: "2026-10-21T00:00:00.000Z",
      updatedAt: "2026-10-21T00:00:00.000Z",
    }
    let listener: ((envelope: unknown) => void) | null = null
    let seq = 0
    const emit = (event: BridgeEvent) =>
      listener?.({
        version: 1,
        sessionId: "s-1",
        seq: event.type === "delta" ? null : (seq += 1),
        at: new Date().toISOString(),
        event,
      })
    const assistant = (id: string, blocks: unknown[], extra: object = {}) => ({
      type: "message",
      messageId: id,
      model: "claude-sonnet",
      parentToolUseId: null,
      blocks,
      ...extra,
    })
    const install = (session: Record<string, unknown>) => {
      Object.assign(window, {
        pigclaude: {
          platform: "darwin",
          membership: {
            inspect: async () => membership,
            subscribe: () => () => undefined,
            withdraw: async () => membership,
            signOut: async () => membership,
          },
          claudeAccounts: {
            list: async () => [account],
            authorize: reject,
            cancelAuthorization: async () => undefined,
            update: reject,
            remove: async () => undefined,
            importFromClaudeCli: reject,
            subscribe: () => () => undefined,
          },
          proxies: {
            list: async () => [],
            save: reject,
            remove: async () => undefined,
            test: reject,
          },
          egress: { check: reject },
          workspaces: {
            list: async () => ["/Users/me/work/api"],
            add: async () => ["/Users/me/work/api"],
            files: async () => [],
            names: async () => ({}),
            rename: async () => ({}),
            remove: async () => [],
            reveal: async () => undefined,
            apps: async () => [],
            openWith: async () => undefined,
          },
          session: {
            start: async () => {
              setTimeout(() =>
                emit({
                  type: "started",
                  sessionId: "s-1",
                  model: "claude-sonnet",
                  tools: [],
                  permissionMode: "default",
                }),
              )
              return { sessionId: "s-1" }
            },
            send: async () => undefined,
            cancel: async () => undefined,
            respondPermission: async () => undefined,
            answerQuestion: async () => undefined,
            setMode: async () => undefined,
            setModel: async () => undefined,
            stop: async () => undefined,
            events: async () => [],
            models: async () => ({
              models: [
                { id: "claude-sonnet", displayName: "Sonnet", description: "", isDefault: true },
              ],
              cliError: null,
            }),
            status: async () => ({
              active: false,
              sessionId: null,
              model: null,
              permissionMode: "default",
              accountId: null,
              pendingPermissions: 0,
              pendingQuestions: 0,
              turnId: null,
            }),
            subscribe: (next: (envelope: unknown) => void) => {
              listener = next
              return () => {
                listener = null
              }
            },
            ...session,
          },
        },
      })
    }
    const bridge: ChatBridge = { emit, assistant, install }
    Object.assign(window, { __chatBridge: bridge })
  })
}
