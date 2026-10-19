// 负责提供本文件的前端契约、组件或样式实现。
import type { SVGProps } from "react"

/** Exact rounded wordmark from apps/desktop/brand/pigclaude-wordmark.svg; no font fallback. */
/** 对外导出该符号，保证调用方使用稳定的前端契约。 */
export function PigclaudeWordmark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 500 116"
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <g transform="translate(2 7)">
        <g transform="translate(0 0)">
          <path
            d="M10 90V8"
            fill="none"
            stroke="currentColor"
            strokeWidth="9.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 17C19 4 48 2 55 20C65 45 44 65 21 57C15 55 10 50 10 43"
            fill="none"
            stroke="currentColor"
            strokeWidth="9.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <g transform="translate(63 0)">
          <path
            d="M15 23V58"
            fill="none"
            stroke="currentColor"
            strokeWidth="9.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="15" cy="5" r="4.75" fill="currentColor" />
        </g>
        <g transform="translate(91 0)">
          <path
            d="M52 32C52 17 42 6 30 6C18 6 8 17 8 32C8 47 18 58 30 58C42 58 52 47 52 32Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="9.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M52 8V76C52 92 22 100 10 83"
            fill="none"
            stroke="currentColor"
            strokeWidth="9.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <g transform="translate(154 0)">
          <path
            d="M49 13C36 0 9 5 8 31C7 57 32 65 49 52"
            fill="none"
            stroke="currentColor"
            strokeWidth="9.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <g transform="translate(212 0)">
          <path
            d="M9 8V38C9 66 51 67 51 38V8"
            fill="none"
            stroke="currentColor"
            strokeWidth="9.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <g transform="translate(274 0)">
          <path
            d="M10 59V9"
            fill="none"
            stroke="currentColor"
            strokeWidth="9.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 26C18 10 31 5 45 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="9.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <g transform="translate(324 0)">
          <path
            d="M46 12C32 -1 9 6 9 20C9 35 45 29 45 44C45 60 22 65 8 54"
            fill="none"
            stroke="currentColor"
            strokeWidth="9.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <g transform="translate(383 0)">
          <path
            d="M52 33C52 17 42 6 30 6C18 6 8 17 8 33C8 49 18 60 30 60C42 60 52 49 52 33Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="9.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <g transform="translate(446 0)">
          <path
            d="M10 59V9"
            fill="none"
            stroke="currentColor"
            strokeWidth="9.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 26C18 10 31 5 45 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="9.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  )
}
