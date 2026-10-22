// 负责支付网关回跳，只保留格式合法的订单号，丢弃签名及其他参数。
/** 固定 307 跳转会员页；不把网关回跳当作支付成功证明。 */
export function GET(request: Request): Response {
  const source = new URL(request.url)
  const target = new URL("/membership", source.origin)
  const orders = source.searchParams.getAll("order")
  if (orders.length === 1 && /^PC[0-9A-Z]{20}$/.test(orders[0]))
    target.searchParams.set("order", orders[0])
  return Response.redirect(target, 307)
}
