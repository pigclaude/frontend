// 从 Agent 的隔离引用表读取动作目标，将原生输入约束到已批准的文档。

import type { WebContents } from "electron"
import { browserTypeTextLimit, type BrowserTypeInput } from "../../browser-permission-contract"
import { isAgentBrowserAddress } from "./agent-browser-network"
import { clickBrowserPoint, typeInBrowserField } from "./browser-action-execution"
import { BrowserActionError, type PreparedBrowserAction } from "./browser-action-request"
import {
  StaleBrowserReference,
  type AgentBrowserElement,
  type BrowserReferences,
} from "./browser-references"

/** 会话请求在当前文档中点击或输入的意向。 */
export type AgentElementAction =
  { kind: "click"; ref: string } | { kind: "type"; input: BrowserTypeInput }

type ApprovedElement = {
  context: Extract<PreparedBrowserAction["context"], { kind: "click" | "type" }>
  verifyDocument(): void
  run(signal: AbortSignal, assertCurrent: () => void): Promise<void>
}

/** 获取实际 URL、元素和输入属性；将焦点、滚动和原生写入留给获批后的动作。 */
export async function prepareBrowserElementAction(
  contents: WebContents,
  references: BrowserReferences,
  action: AgentElementAction,
): Promise<ApprovedElement> {
  const verifyDocument = references.documentGuard()
  const url = contents.getURL()
  if (!isAgentBrowserAddress(url)) throw new StaleBrowserReference()

  if (action.kind === "click") {
    const target = await references.resolve(action.ref)
    verifyDocument()
    return {
      context: { kind: "click", ...details(url, target) },
      verifyDocument,
      run: (signal, assertCurrent) =>
        clickBrowserPoint(contents, () => references.clickPoint(target), assertCurrent, signal),
    }
  }

  const input = action.input
  if (input.text.length > browserTypeTextLimit)
    throw new BrowserActionError("The text exceeds the browser input limit. Use a shorter value.")
  const target = await references.resolveInput(input.ref)
  verifyDocument()
  return {
    context: {
      kind: "type",
      ...details(url, target),
      isPassword: target.isPassword,
      characterCount: [...input.text].length,
      clear: input.clear,
      submit: input.submit,
    },
    verifyDocument,
    run: (signal, assertCurrent) =>
      typeInBrowserField(
        contents,
        input,
        {
          focus: () => references.requireInputFocus(target, "focus"),
          checkFocus: () => references.requireInputFocus(target, "check"),
          sameDocument() {
            try {
              verifyDocument()
              return true
            } catch (error) {
              if (error instanceof StaleBrowserReference) return false
              throw error
            }
          },
        },
        assertCurrent,
        signal,
      ),
  }
}

function details(url: string, { ref, role, name }: AgentBrowserElement) {
  return { url, ref, role, name }
}
