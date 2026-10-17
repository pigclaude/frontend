// 负责提供本文件的前端契约、组件或样式实现。
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
