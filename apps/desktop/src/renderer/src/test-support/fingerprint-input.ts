// 负责测试中填写指纹字段：先通过真实下拉切到自定义，再输入文本，不绕过控件交互。

import { act } from "react"
import { chooseSelect } from "./radix-select"

/** 填写文本或指纹自定义值，返回实际输入元素；未找到字段时明确失败。 */
export async function fillFingerprintField(
  scope: ParentNode,
  id: string,
  value: string,
): Promise<HTMLInputElement | HTMLTextAreaElement> {
  let element =
    scope.querySelector<HTMLElement>(`#${id}-custom`) ?? scope.querySelector<HTMLElement>(`#${id}`)
  if (element?.getAttribute("role") === "combobox") {
    await chooseSelect(element, "自定义…")
    element = scope.querySelector<HTMLElement>(`#${id}-custom`)
  }
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error(`输入字段不存在：${id}`)
  }
  const input = element
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  return input
}
