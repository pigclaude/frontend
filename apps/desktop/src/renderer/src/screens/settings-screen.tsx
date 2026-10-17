// 负责设置里的账户、规则、外观和数据页面，内容来自设计稿。
import { useState } from "react"
import type { ReactNode } from "react"
import { Icon } from "../components/icon"
import { Button } from "../components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog"
import { Switch } from "../components/ui/switch"
import type { Screen } from "./screen"

/** 画出当前设置分区。 */
export function SettingsScreen({
  screen,
  onNavigate,
}: {
  screen: Screen
  onNavigate: (screen: Screen) => void
}) {
  const [clearOpen, setClearOpen] = useState(false)
  if (screen === "profile") {
    return (
      <Page title="我的账户" sub="登录 pigclaude 的账户，只用来确认你能不能使用这套软件">
        <Section title="使用权限">
          <Item
            title="林舟"
            desc="lin•••@example.com"
            extra={<span className="status ok">已开通</span>}
          />
          <Item title="上次校验" desc="今天 09:00 · 本机" />
        </Section>
        <div style={{ marginTop: 28 }}>
          <Button variant="secondary" onClick={() => onNavigate("login")}>
            <Icon name="exit" />
            退出登录
          </Button>
        </div>
      </Page>
    )
  }
  if (screen === "switching") {
    return (
      <Page title="切换规则" sub="什么时候从一个 Claude 账号换到下一个">
        <Section title="窗口">
          <Item
            title="5 小时窗口"
            desc="达到这个用量就换下一个账号"
            extra={<b className="num">100%</b>}
          />
          <Item
            title="7 天窗口"
            desc="达到这个用量就换下一个账号"
            extra={<b className="num">100%</b>}
          />
        </Section>
      </Page>
    )
  }
  if (screen === "general") {
    return (
      <Page title="通用">
        <Section title="启动">
          <Item
            title="开机自动启动"
            desc="登录后在后台运行"
            extra={<Switch defaultChecked aria-label="开机自动启动" />}
          />
        </Section>
      </Page>
    )
  }
  if (screen === "appearance") {
    return (
      <Page title="外观">
        <Section title="主题">
          <Item
            title="外观"
            desc="跟随系统、浅色或深色"
            extra={<span className="muted">浅色</span>}
          />
        </Section>
      </Page>
    )
  }
  if (screen === "session") {
    return (
      <Page title="会话" sub="新会话的默认值，以及会话进程怎么运行">
        <Section title="会话进程">
          <Item
            title="请求地址"
            desc="指向本机中继"
            extra={<span className="mono">127.0.0.1:47821</span>}
          />
          <Item
            title="用户的 settings.json"
            desc="应用内会话不读取它"
            extra={<span className="muted">已忽略</span>}
          />
        </Section>
      </Page>
    )
  }
  if (screen === "network") {
    return (
      <Page title="中继与网络">
        <Section title="中继">
          <Item
            title="监听"
            desc="只接受本机"
            extra={<span className="mono">127.0.0.1:47821</span>}
          />
        </Section>
      </Page>
    )
  }
  if (screen === "data") {
    return (
      <Page title="数据与隐私" sub="所有数据都在这台电脑上">
        <Section title="用量记录">
          <Item title="保存内容" desc="时间、账号、模型、状态码、耗时和 Token 数" />
          <Item
            title="清除全部用量记录"
            desc="Claude 账号、代理和会话都不受影响"
            extra={
              <Button variant="danger" size="sm" onClick={() => setClearOpen(true)}>
                清除
              </Button>
            }
          />
        </Section>
        <Dialog open={clearOpen} onOpenChange={setClearOpen}>
          <DialogContent>
            <div className="dialog-head">
              <DialogTitle>清除全部用量记录？</DialogTitle>
              <DialogDescription>Claude 账号、代理和会话都不受影响。</DialogDescription>
            </div>
            <div className="dialog-foot">
              <Button variant="ghost" onClick={() => setClearOpen(false)}>
                取消
              </Button>
              <Button variant="solidDanger" onClick={() => setClearOpen(false)}>
                清除
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </Page>
    )
  }
  if (screen === "about") {
    return (
      <Page title="关于">
        <Section title="pigclaude">
          <Item title="凭据、指纹和代理" desc="只留在这台电脑上" />
        </Section>
      </Page>
    )
  }
  return null
}

/** 设置页的标题。 */
function Page({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {sub ? <p className="sub">{sub}</p> : null}
        </div>
      </header>
      {children}
    </div>
  )
}

/** 一组设置。 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
      </div>
      <div className="group">{children}</div>
    </section>
  )
}

/** 设置里的一行。 */
function Item({ title, desc, extra }: { title: string; desc?: string; extra?: ReactNode }) {
  return (
    <div className="item">
      <div className="main">
        <div className="ttl">{title}</div>
        {desc ? <div className="desc">{desc}</div> : null}
      </div>
      {extra}
    </div>
  )
}
