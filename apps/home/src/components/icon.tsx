// 提供用户端手绘24格图标，描线动效遵守系统减少动态效果偏好。
/** 成功对勾仅作视觉反馈，状态文本负责读屏播报。 */
export function SuccessCheck() {
  return (
    <svg
      className="membership-success-check"
      aria-hidden="true"
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path pathLength="1" d="m5 12 4 4L19 6" />
    </svg>
  )
}
