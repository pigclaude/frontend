// 负责首次进入应用时的三步引导和快速添加代理。
import { useState } from "react"
import { Button } from "../components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { Switch } from "../components/ui/switch"

/** 首次引导页面 props。 */
export type OnboardingScreenProps = {
  onDone: () => void
  onOpenAuthorize: () => void
}

/** 绘制三步接通号池引导。 */
export function OnboardingScreen({ onDone, onOpenAuthorize }: OnboardingScreenProps) {
  const [proxyOpen, setProxyOpen] = useState(false)
  const [proxyAdded, setProxyAdded] = useState(false)
  const [accountAdded, setAccountAdded] = useState(false)
  return (
    <div className="setup">
      <div className="page narrow">
        <header className="page-head">
          <div>
            <h1>欢迎，林舟</h1>
            <p className="sub">三步接通你的号池，之后就可以在这里写代码了。</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onDone}>
            稍后再说
          </Button>
        </header>
        <div className="group" data-od-id="onboarding-steps">
          <div className="item step-item is-current">
            <span className="k">1</span>
            <div className="main">
              <div className="ttl">添加第一个代理</div>
              <div className="desc">登录和对话都只走账号绑定的代理</div>
            </div>
            {proxyAdded ? (
              <span className="status ok">完成</span>
            ) : (
              <Button size="sm" variant="primary" onClick={() => setProxyOpen(true)}>
                添加代理
              </Button>
            )}
          </div>
          <div className={proxyAdded ? "item step-item is-current" : "item step-item is-locked"}>
            <span className="k">2</span>
            <div className="main">
              <div className="ttl">添加 Claude 账号</div>
              <div className="desc">在外部指纹浏览器里走官方登录，出口一致才会继续</div>
            </div>
            {accountAdded ? (
              <span className="status ok">完成</span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={!proxyAdded}
                onClick={() => {
                  setAccountAdded(true)
                  onOpenAuthorize()
                }}
              >
                添加账号
              </Button>
            )}
          </div>
          <div className={accountAdded ? "item step-item is-current" : "item step-item is-locked"}>
            <span className="k">3</span>
            <div className="main">
              <div className="ttl">开始第一个会话</div>
              <div className="desc">会话在独立目录里运行，不读你的 ~/.claude/settings.json</div>
            </div>
            <Switch
              checked={accountAdded}
              onCheckedChange={() => {
                if (accountAdded) onDone()
              }}
              aria-label="开始第一个会话"
              disabled={!accountAdded}
            />
          </div>
        </div>
        <div className="setup-actions">
          <Button variant="primary" onClick={onDone} disabled={!accountAdded}>
            进入会话
          </Button>
        </div>
      </div>
      <Dialog open={proxyOpen} onOpenChange={setProxyOpen}>
        <DialogContent>
          <div className="dialog-head">
            <DialogTitle>添加第一个代理</DialogTitle>
            <DialogDescription>
              粘贴代理服务商给你的地址，之后可以在代理池里修改。
            </DialogDescription>
          </div>
          <div className="dialog-body">
            <div className="field">
              <label htmlFor="onboarding-proxy">代理地址</label>
              <Input
                id="onboarding-proxy"
                className="mono"
                placeholder="http://user:pass@host:8000"
              />
            </div>
            <p className="hint">支持 http、https、socks5；添加前会先测试一次。</p>
          </div>
          <div className="dialog-foot">
            <Button variant="ghost" onClick={() => setProxyOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setProxyAdded(true)
                setProxyOpen(false)
              }}
            >
              测试并添加
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
