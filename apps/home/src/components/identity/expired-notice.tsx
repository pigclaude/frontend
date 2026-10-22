// 负责中央身份交互过期后的唯一提示：网站交互给出原站重新登录入口，桌面端交互提示回到客户端发起。
import { Button } from "@pigclaude/web-ui/components/button"

/** 只渲染一条过期提示；restartUrl 来自服务器视图，不由页面拼接。 */
export function ExpiredNotice({
  restartUrl,
  className,
}: {
  restartUrl: string | null
  className: string
}) {
  return (
    <div role="alert" className={`mt-5 flex flex-col gap-3 ${className}`}>
      <p>
        {restartUrl
          ? "登录页面停留太久，本次登录已过期，请重新登录。"
          : "本次授权已过期，请回到 PigClaude 桌面端重新发起授权。"}
      </p>
      {restartUrl && (
        <Button asChild size="sm" className="self-start">
          <a href={restartUrl}>重新登录</a>
        </Button>
      )}
    </div>
  )
}
