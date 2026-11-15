// 声明主进程使用的 YAML 数据解析和序列化接口。
declare module "js-yaml" {
  /** 按默认安全数据类型解析一份 YAML 文档。 */
  export function load(source: string): unknown

  /** 将数据按指定的键顺序和行宽序列化。 */
  export function dump(value: unknown, options?: { sortKeys?: boolean; lineWidth?: number }): string
}
