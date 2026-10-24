// 验证标准 OAuth 响应的公开字段与 native 无 ID Token 边界。
import { describe, expect, expectTypeOf, it } from "vitest"
import {
  isNativeOAuthTokenResponse,
  isOAuthErrorResponse,
  type NativeOAuthTokenResponse,
  type OAuthTokenResponse,
} from "./oauth"

describe("OAuth wire contracts", () => {
  it("accepts only standard snake_case token fields and an access lifetime of at most one hour", () => {
    const response = {
      access_token: "pc_at_opaque",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "pc_rt_opaque",
      scope: "user:read device:revoke",
    } satisfies OAuthTokenResponse
    expect(isNativeOAuthTokenResponse(JSON.parse(JSON.stringify(response)))).toBe(true)
    expect(
      isNativeOAuthTokenResponse({
        accessToken: "pc_at_opaque",
        tokenType: "Bearer",
        expiresIn: 300,
      }),
    ).toBe(false)
    expect(isNativeOAuthTokenResponse({ ...response, expires_in: 120 })).toBe(true)
    expect(isNativeOAuthTokenResponse({ ...response, expires_in: 3601 })).toBe(false)
    expect(isNativeOAuthTokenResponse({ ...response, expires_in: 0 })).toBe(false)
    expect(isNativeOAuthTokenResponse({ ...response, expires_in: 1.5 })).toBe(false)
    expect(isNativeOAuthTokenResponse({ ...response, id_token: "jwt" })).toBe(false)
    expectTypeOf<Extract<"id_token", keyof NativeOAuthTokenResponse>>().toEqualTypeOf<never>()
  })
  it("preserves standard protocol errors with optional fixed application detail", () => {
    expect(
      isOAuthErrorResponse({
        error: "invalid_grant",
        error_description: "expired",
        app_error: "ACCOUNT_BANNED",
      }),
    ).toBe(true)
    expect(isOAuthErrorResponse({ error: "invalid_grant" })).toBe(true)
    expect(isOAuthErrorResponse({ error: "invalid_grant", app_error: "arbitrary" })).toBe(false)
    expect(isOAuthErrorResponse({ code: "invalid_grant", message: "expired" })).toBe(false)
  })
})
