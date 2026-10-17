// 负责验证 QueryClient 的 query 和 mutation 401 recovery 都触发管理员登录回跳。
import { describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"

const redirectToLogin = vi.hoisted(() => vi.fn())
vi.mock("@/lib/navigation", () => ({ redirectToLogin }))

import { createAdminQueryClient } from "./query-client"

describe("admin QueryClient auth recovery", () => {
  it("redirects a failed query on 401", async () => {
    const client = createAdminQueryClient()
    await expect(
      client.fetchQuery({
        queryKey: ["unauthorized-query"],
        retry: false,
        queryFn: async () => {
          throw new ApiError(401)
        },
      }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(redirectToLogin).toHaveBeenCalledOnce()
  })

  it("redirects a failed mutation on 401", async () => {
    const client = createAdminQueryClient()
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => {
        throw new ApiError(401)
      },
    })
    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(ApiError)
    expect(redirectToLogin).toHaveBeenCalledTimes(2)
  })
})
