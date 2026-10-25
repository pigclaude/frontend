// 负责把一行说明的若干片段用「 · 」连起来，缺的片段直接省略，不显示占位符。
import { Fragment, type ReactNode } from "react"

/** 一行说明里的一个片段；null、undefined、false 和空字符串都算缺失。 */
export type MetaPart = ReactNode | null | undefined | false

/** 去掉缺失的片段；调用方据此判断这一行说明要不要渲染。 */
export function presentParts(parts: readonly MetaPart[]): ReactNode[] {
  return parts.filter(
    (part): part is ReactNode =>
      part !== null && part !== undefined && part !== false && part !== "",
  )
}

/** 依次渲染非空片段；全部为空时什么都不渲染。 */
export function MetaLine({ parts }: { parts: readonly MetaPart[] }) {
  const present = presentParts(parts)
  if (present.length === 0) return null
  return (
    <>
      {present.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && " · "}
          {part}
        </Fragment>
      ))}
    </>
  )
}
