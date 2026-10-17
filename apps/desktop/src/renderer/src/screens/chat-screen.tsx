// 负责新会话和进行中的会话，包括许可、换号提示和输入框。
import { useState } from "react"
import { Composer } from "../components/composer"
import { Icon } from "../components/icon"
import { Button } from "../components/ui/button"
import type { Screen } from "./screen"

/** 画出新会话或正在进行的会话。 */
export function ChatScreen({
  fresh,
  onOpen,
}: {
  fresh: boolean
  onOpen: (screen: Screen) => void
}) {
  const [allowed, setAllowed] = useState(false)
  const [model, setModel] = useState("Sonnet 5.5")
  const [account, setAccount] = useState("主力 Max")
  const [depth, setDepth] = useState<"off" | "low" | "medium" | "high" | "max">("medium")
  if (fresh) {
    return (
      <section className="view">
        <div className="panel-top">
          <span className="spacer" />
        </div>
        <div className="hero">
          <div className="hero-inner">
            <div className="ctx-row">
              <span className="chip-btn">
                <Icon name="folder" small />
                frontend
                <Icon name="down" small />
              </span>
              <span className="chip-btn">
                <span className="dot ok" />
                {account}
              </span>
              <span className="chip-btn">
                <Icon name="globe" small />
                LA-01
              </span>
            </div>
            <Composer
              placeholder="让 Claude 做点什么，@ 引用文件，/ 使用命令"
              tall
              menuSide="bottom"
              model={model}
              onModel={setModel}
              account={account}
              onAccount={setAccount}
              showAccount={false}
              depth={depth}
              onDepth={setDepth}
              onSubmit={() => onOpen("chat")}
            />
            <div className="suggest">
              <button className="sg" type="button" onClick={() => onOpen("chat")}>
                <span className="tile">
                  <Icon name="clock" />
                </span>
                <b>继续上次</b>
                <span className="truncate">流开始后不再换号 · frontend</span>
              </button>
              <button className="sg" type="button">
                <span className="tile">
                  <Icon name="eye" />
                </span>
                <b>审查改动</b>
                <span className="truncate">看看改了什么、有没有风险</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }
  return (
    <section className="view">
      <div className="panel-top">
        <div className="title">
          <Icon name="folder" />
          <span className="truncate">流开始后不再换号</span>
        </div>
        <span className="spacer" />
        <span className="status warn">等待许可</span>
      </div>
      <div className="thread">
        <div className="msgs">
          <div className="msg-user">
            daemon 里响应体已经开始写出之后，遇到 429
            还会再请求一次上游。改成一旦开始写就不再换号，并补一条测试。
          </div>
          <div className="msg-ai">
            <p>先看现在的重试逻辑在哪里判断「是否已写出响应体」。</p>
            <p>
              问题在 <code>forwardWithRetry</code>：判断 429 时没有看 <code>state.bodyStarted</code>
              。
            </p>
            <div className="event-line">
              <Icon name="swap" small />
              <span className="num">14:32</span> 工作 Max 额度用尽，中继在同一请求内换到主力 Max
            </div>
            {!allowed ? (
              <div className="perm">
                <div className="q">
                  <Icon name="hand" />
                  允许运行这条命令吗？
                </div>
                <pre>pnpm --dir packages/daemon exec vitest run src/daemon-quota-proxy.test.ts</pre>
                <div className="acts">
                  <Button variant="primary" onClick={() => setAllowed(true)}>
                    允许一次
                  </Button>
                  <Button variant="secondary" onClick={() => setAllowed(true)}>
                    本会话内允许
                  </Button>
                  <Button variant="ghost">拒绝</Button>
                </div>
              </div>
            ) : (
              <div className="perm-done">
                <Icon name="check" small />
                已允许一次
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="composer-wrap">
        <Composer
          placeholder="继续追问"
          menuSide="top"
          model={model}
          onModel={setModel}
          account={account}
          onAccount={setAccount}
          showAccount
          depth={depth}
          onDepth={setDepth}
          onSubmit={() => undefined}
        />
      </div>
    </section>
  )
}
