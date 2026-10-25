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

/** 支付宝渠道标记：手绘「支」字线稿，叠在二维码中央，颜色由外层决定。 */
export function AlipayMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 7.5h14M12 4v6.5M7 11h10c-1.6 4.6-5.2 7.6-10 9" />
      <path d="M9.5 14c2.4 2.4 5.6 4.4 9.5 5.5" />
    </svg>
  )
}

/** 微信支付渠道标记：手绘两只对话气泡，叠在二维码中央，颜色由外层决定。 */
export function WechatPayMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 4.5c-3.6 0-6.5 2.3-6.5 5.2 0 1.6.9 3 2.3 4L4.8 16l2.6-1.3c.7.2 1.4.3 2.1.3" />
      <path d="M14.8 9c3.4 0 6.2 2.2 6.2 4.9 0 1.4-.8 2.7-2 3.6l.4 2-2.3-1.1c-.7.2-1.5.3-2.3.3-3.4 0-6.2-2.2-6.2-4.8S11.4 9 14.8 9Z" />
      <path d="M7 8.5h.01M11.5 8.5h.01M13 13h.01M16.6 13h.01" />
    </svg>
  )
}

/** 面板右上角的关闭叉号，按钮自身提供可读名称。 */
export function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  )
}

/** macOS 电脑标记：手绘苹果轮廓加叶子，颜色由外层决定。 */
export function AppleMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15.2 3.6c-1.4.2-2.6 1.2-2.9 2.6 1.4-.1 2.6-1.1 2.9-2.6Z" />
      <path d="M12 8c-.9-.5-1.9-.9-2.9-.9-2.4 0-4.4 2-4.4 5.2 0 3.6 2.4 8.1 4.6 8.1.9 0 1.6-.5 2.7-.5s1.8.5 2.7.5c1.6 0 3.3-2.3 4.1-4.7-1.6-.8-2.6-2.2-2.6-3.9 0-1.5.8-2.8 2-3.5-.9-1-2.1-1.6-3.4-1.6-1.1 0-2 .5-2.8 1.3Z" />
    </svg>
  )
}

/** Windows 电脑标记：手绘四块略带透视的窗格，颜色由外层决定。 */
export function WindowsMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6 10.5 5v6H4zM13 4.6 20 3.5V11h-7zM4 13h6.5v6L4 18zM13 13h7v7.5l-7-1.1z" />
    </svg>
  )
}

/** Linux 电脑标记：手绘企鹅轮廓、肚皮和嘴，颜色由外层决定。 */
export function LinuxMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3c-2.1 0-3.4 1.8-3.4 4.2 0 1.5-.6 2.6-1.6 4-1.2 1.6-2.2 3.4-2.2 5.3 0 2.1 3.2 3.9 7.2 3.9s7.2-1.8 7.2-3.9c0-1.9-1-3.7-2.2-5.3-1-1.4-1.6-2.5-1.6-4C15.4 4.8 14.1 3 12 3Z" />
      <path d="M9.4 14.2c.6-1.4 1.5-2.1 2.6-2.1s2 .7 2.6 2.1M10.6 6.9h.01M13.4 6.9h.01M11 8.9l1 .8 1-.8" />
    </svg>
  )
}
