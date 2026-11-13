// 将工具事件里的绝对路径映射到当前工作台项目，主进程仍核对真实文件。
/** 只返回项目内的相对路径；支持 macOS 的 /var 别名和 Windows 的路径分隔符。 */
export function workbenchRelativePath(root: string, input: string): string | null {
  const value = input.replaceAll("\\", "/")
  const directory = root.replaceAll("\\", "/").replace(/\/+$/, "")
  const windows = /^[a-z]:\//i.test(value) || /^[a-z]:\//i.test(directory + "/")
  const normalize = (path: string) =>
    windows ? path.toLowerCase() : path.replace(/^\/private(?=\/(?:var|tmp)\/)/, "")
  const base = normalize(directory)
  const source = normalize(value)
  const original = windows ? value : normalize(value)
  const isAbsolute = value.startsWith("/") || /^[a-z]:\//i.test(value)
  const path = isAbsolute
    ? source.startsWith(base + "/")
      ? original.slice(base.length + 1)
      : ""
    : value
  const segments = path.split("/")
  return path &&
    segments.every(
      (segment) => segment && segment !== ".." && segment !== "." && !segment.includes(":"),
    )
    ? path
    : null
}
