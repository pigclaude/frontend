// 负责新会话、进行中会话、权限询问和会话环境抽屉。
import { useState } from "react"
import { Composer } from "../components/composer"
import { Icon } from "../components/icon"
import { Button } from "../components/ui/button"
import type { PermissionMode, ThinkingDepth } from "../components/composer-options"
import type { SessionFixture } from "../fixtures/chat-fixtures"
import type { Screen } from "./screen"

/** 会话页面 props。 */
export type ChatScreenProps = {
  fresh: boolean
  sessionFixture: SessionFixture
  onOpen: (screen: Screen) => void
  smartPunctuation: boolean
}

/** 绘制新会话或进行中的会话页面。 */
export function ChatScreen({ fresh, sessionFixture, onOpen, smartPunctuation }: ChatScreenProps) {
  const [model, setModel] = useState("Sonnet 5.5")
  const [account, setAccount] = useState(sessionFixture.account)
  const [depth, setDepth] = useState<ThinkingDepth>("medium")
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("ask")
  const [allowed, setAllowed] = useState(false)
  const [stepsOpen, setStepsOpen] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  if (fresh) {
    return (
      <section className="view">
        <div className="panel-top">
          <span className="spacer" />
          <Button variant="plain" className="icon-btn" type="button" aria-label="搜索">
            <Icon name="search" />
          </Button>
        </div>
        <div className="hero">
          <div className="hero-inner">
            <div className="ctx-row">
              <Button variant="plain" className="chip-btn" type="button">
                <Icon name="folder" small />
                {sessionFixture.project}
                <Icon name="down" small />
              </Button>
              <Button variant="plain" className="chip-btn" type="button">
                <span className="dot ok" />
                {account}
                <Icon name="down" small />
              </Button>
              <Button variant="plain" className="chip-btn" type="button">
                <Icon name="globe" small />
                {sessionFixture.proxy}
              </Button>
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
              permissionMode={permissionMode}
              onPermissionMode={setPermissionMode}
              smartPunctuation={smartPunctuation}
              onSubmit={() => onOpen("chat")}
            />
            <div className="suggest">
              {sessionFixture.suggestions.map((suggestion) => (
                <Button
                  variant="plain"
                  key={suggestion.title}
                  className="sg"
                  type="button"
                  onClick={() => onOpen("chat")}
                >
                  <span className="tile">
                    <Icon name={suggestion.icon} />
                  </span>
                  <b>{suggestion.title}</b>
                  <span className="truncate">{suggestion.description}</span>
                </Button>
              ))}
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
          <Icon name="folder" className="muted" />
          <span className="truncate">流开始后不再换号</span>
        </div>
        <Button variant="plain" className="icon-btn" type="button" aria-label="更多操作">
          <Icon name="more" />
        </Button>
        <span className="spacer" />
        <span className="status warn">{allowed ? "运行中" : "等待许可"}</span>
        <Button
          variant="plain"
          className="icon-btn"
          type="button"
          aria-label="会话环境"
          onClick={() => setDrawerOpen((value) => !value)}
        >
          <Icon name="sidebar" />
        </Button>
      </div>
      <div className="thread">
        <div className="msgs">
          <div className="msg-user">{sessionFixture.userMessage}</div>
          <div className="msg-ai">
            <p>{sessionFixture.assistantParagraphs[0]}</p>
            <div>
              <Button
                variant="plain"
                className="steps-line"
                type="button"
                aria-expanded={stepsOpen}
                onClick={() => setStepsOpen((value) => !value)}
              >
                <Icon name="right" small className="chev" />
                读取 {sessionFixture.steps.length} 个文件，搜索 1 次
              </Button>
              {stepsOpen ? (
                <div className="steps-list">
                  {sessionFixture.steps.map((step) => (
                    <div key={step.kind}>
                      <Icon name="file" small />
                      <b>{step.kind}</b>
                      <span className="mono">{step.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <p>{sessionFixture.assistantParagraphs[1]}</p>
            <div className="event-line">
              <Icon name="swap" small />
              <span className="num">{sessionFixture.relayEvent.time}</span>
              {sessionFixture.relayEvent.text}
            </div>
            <div className={diffOpen ? "result is-open" : "result"}>
              <Button
                variant="plain"
                className="result-head"
                type="button"
                onClick={() => setDiffOpen((value) => !value)}
              >
                <Icon name="right" small className="chev" />
                <span>{sessionFixture.diff.files.length} 个文件已更改</span>
                <span className="num t-ok">+{sessionFixture.diff.additions}</span>
                <span className="num t-bad">−{sessionFixture.diff.deletions}</span>
                <span className="grow" />
                <span className="muted">查看</span>
              </Button>
              {diffOpen ? (
                <div className="result-body">
                  <div className="diff">
                    {sessionFixture.diff.lines.map((line, index) => (
                      <div
                        key={`${line}-${index}`}
                        className={
                          line.startsWith("+") ? "add" : line.startsWith("−") ? "del" : "hunk"
                        }
                      >
                        <span className="ln">{151 + index}</span>
                        <span className="sg">
                          {line.startsWith("+") || line.startsWith("−") ? line[0] : " "}
                        </span>
                        <span>{line.replace(/^[+−]/, "")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <p>{sessionFixture.assistantParagraphs[2]}</p>
            {!allowed ? (
              <div className="perm">
                <div className="q">
                  <Icon name="hand" />
                  {sessionFixture.permission.description}
                </div>
                <pre>{sessionFixture.permission.command}</pre>
                <div className="acts">
                  <Button variant="primary" onClick={() => setAllowed(true)}>
                    允许一次
                  </Button>
                  <Button variant="secondary" onClick={() => setAllowed(true)}>
                    本会话内允许
                  </Button>
                  <Button variant="ghost">拒绝</Button>
                  <span className="keys">⏎ 允许 · esc 拒绝</span>
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
          permissionMode={permissionMode}
          onPermissionMode={setPermissionMode}
          smartPunctuation={smartPunctuation}
          onSubmit={() => undefined}
        />
        <p className="composer-meta">
          经代理 {sessionFixture.proxy} 发出 · pigclaude 只记录用量元数据
        </p>
      </div>
      {drawerOpen ? <SessionDrawer fixture={sessionFixture} /> : null}
    </section>
  )
}

function SessionDrawer({ fixture }: { fixture: SessionFixture }) {
  return (
    <aside className="drawer" aria-label="会话环境">
      <div className="section">
        <div className="section-head">
          <h2>会话环境</h2>
          <span className="end">全部一致</span>
        </div>
        <div className="group">
          {fixture.environment.map((item) => (
            <div className="item" key={item.label}>
              <div className="main">
                <div className="ttl">{item.label}</div>
                <div className="desc mono">{item.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="section">
        <div className="section-head">
          <h2>服务账号</h2>
          <span className="end">换号 1 次</span>
        </div>
        <div className="group">
          {fixture.accounts.map((account) => (
            <div className="item" key={account.name}>
              <span className="avatar sm">{account.name.slice(0, 1)}</span>
              <div className="main">
                <div className="ttl">{account.name}</div>
              </div>
              <span className="val">{account.time}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="section">
        <div className="section-head">
          <h2>本会话用量</h2>
        </div>
        <div className="group">
          <div className="item">
            <div className="main">
              <div className="ttl">请求</div>
            </div>
            <span className="val">{fixture.usage.requests}</span>
          </div>
          <div className="item">
            <div className="main">
              <div className="ttl">Token</div>
            </div>
            <span className="val">{fixture.usage.tokens}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
