// 负责设备授权动态路由切换期间的加载占位。
/** 展示设备授权页面加载占位。 */
export default function AuthorizationLoading() {
  return (
    <main className="page-shell narrow">
      <p role="status">正在读取设备授权…</p>
    </main>
  )
}
