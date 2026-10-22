// 负责等级目录变更成功后的统一缓存失效和会员通知。
import type { QueryClient } from "@tanstack/react-query"

/** 调用方确认操作归属后统一刷新目录相关缓存，不改变页面关闭状态。 */
export function refreshTierCatalog(client: QueryClient): void {
  for (const queryKey of [
    ["admin-tiers"],
    ["admin-memberships"],
    ["admin-audits"],
    ["membership-catalog"],
  ])
    void client.invalidateQueries({ queryKey })
  window.dispatchEvent(new CustomEvent("pigclaude:admin-membership"))
}
