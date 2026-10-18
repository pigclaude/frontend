// 负责在渲染进程检测某个字体族是否装在本机：用画布比较文字宽度，结果按字体族缓存；依赖浏览器，不做单元测试。

const sample = "mmmmmmmmmmlli 字体 0123456789"
const fallbacks = ["monospace", "serif", "sans-serif"] as const
const cache = new Map<string, boolean>()

let context: CanvasRenderingContext2D | null | undefined

function measure(font: string): number | null {
  if (context === undefined) context = document.createElement("canvas").getContext("2d")
  if (!context) return null
  context.font = font
  return context.measureText(sample).width
}

/**
 * 判断字体族是否已安装：用该字体加通用族兜底画文字，只要有一种兜底下宽度和纯兜底不同就算已安装。
 * 画布不可用时保守地返回 false，下拉里只剩系统项。
 */
export function isFontInstalled(family: string): boolean {
  const known = cache.get(family)
  if (known !== undefined) return known
  const installed = fallbacks.some((generic) => {
    const plain = measure(`72px ${generic}`)
    const tried = measure(`72px "${family}", ${generic}`)
    return plain !== null && tried !== null && plain !== tried
  })
  cache.set(family, installed)
  return installed
}
