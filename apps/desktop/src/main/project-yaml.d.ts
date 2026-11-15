// 约束主进程 YAML 解析入口：项目文件解析出的任何值都必须在使用前校验。
declare module "js-yaml" {
  /** 按默认安全数据类型解析一份 YAML 文档。 */
  export function load(source: string): unknown
}
