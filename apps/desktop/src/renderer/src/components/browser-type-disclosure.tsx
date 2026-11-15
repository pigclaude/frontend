// 展示一次浏览器输入的文字和选项，把密码显隐限制在当前审批卡。
import { useId, useState } from "react"
import { Button } from "@pigclaude/ui-primitives"
import type { BrowserPermissionContext } from "../../../browser-permission-contract"
import { fill, useText } from "../locale/text"

type Props = {
  context: Extract<BrowserPermissionContext, { kind: "type" }>
  text: string | undefined
}

/** 仅按需显示活跃审批里的密码，历史掩码仅作为正文占位。 */
export function BrowserTypeDisclosure({ context, text }: Props) {
  const { t } = useText()
  const { characterCount, clear, isPassword, submit } = context
  const [revealed, setRevealed] = useState(false)
  const textId = useId()
  const canReveal = isPassword && characterCount !== undefined && text !== undefined
  const displayed =
    isPassword && !(canReveal && revealed)
      ? t("permission.browser.inputMasked")
      : text || t("permission.browser.inputEmpty")

  return (
    <div className="perm-browser-input">
      <div className="perm-browser-input-head">
        <span>
          {t("permission.browser.inputText")}
          {characterCount === undefined
            ? null
            : ` · ${fill(t("permission.browser.inputCount"), { count: characterCount })}`}
        </span>
        {canReveal ? (
          <Button
            type="button"
            size="sm"
            aria-controls={textId}
            aria-expanded={revealed}
            onClick={() => setRevealed((visible) => !visible)}
          >
            {t(revealed ? "permission.browser.hidePassword" : "permission.browser.showPassword")}
          </Button>
        ) : null}
      </div>
      <pre className="perm-prompt-code" id={textId} dir="auto">
        {displayed}
      </pre>
      <dl className="perm-browser-element">
        <dt>{t("permission.browser.clearFirst")}</dt>
        <dd>{t(clear ? "permission.browser.optionYes" : "permission.browser.optionNo")}</dd>
        <dt>{t("permission.browser.submitAfterTyping")}</dt>
        <dd>{t(submit ? "permission.browser.optionYes" : "permission.browser.optionNo")}</dd>
      </dl>
    </div>
  )
}
