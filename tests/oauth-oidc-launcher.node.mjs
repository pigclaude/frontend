// 负责验证 OAuth/OIDC launcher 的显式设施、归属与 loopback 失败关闭边界。
import test from "node:test"
import assert from "node:assert/strict"
import { validateOAuthInfrastructure } from "../scripts/oauth-oidc-local-launcher.mjs"

test("缺少专用设施必须失败，不能以未验证状态启动", () => {
  assert.throws(() => validateOAuthInfrastructure({}), /OAUTH_TEST_INFRA_REQUIRED/)
})

const valid = {
  DATABASE_URL: "postgres://owner:local@127.0.0.1:63001/pigclaude_oauth_test_123abc",
  PIGCLAUDE_SETTINGS_TEST_DATABASE_URL:
    "postgres://owner:local@127.0.0.1:63001/pigclaude_oauth_test_123abc",
  REDIS_URL: "redis://:local@127.0.0.1:63002/",
  OAUTH_TEST_OWNER: "oauth-oidc:12345678:",
}
test("专用loopback来源和随机隔离标识可通过预校验", () => {
  assert.deepEqual(validateOAuthInfrastructure(valid), { owner: valid.OAUTH_TEST_OWNER })
})
for (const [name, changes] of [
  [
    "LAN postgres",
    { DATABASE_URL: "postgres://owner:secret@192.168.1.2:63001/pigclaude_oauth_test_123abc" },
  ],
  ["LAN redis", { REDIS_URL: "redis://:secret@192.168.1.2:63002" }],
  ["shared database", { DATABASE_URL: "postgres://owner:secret@127.0.0.1:63001/postgres" }],
  ["namespace wildcard", { OAUTH_TEST_OWNER: "oauth-oidc:*:" }],
  ["different database", { PIGCLAUDE_SETTINGS_TEST_DATABASE_URL: "postgres://other" }],
  ["query override", { REDIS_URL: "redis://127.0.0.1:63002/?host=remote" }],
]) {
  test(`拒绝${name}且错误不泄露连接秘密`, () => {
    assert.throws(
      () => validateOAuthInfrastructure({ ...valid, ...changes }),
      (error) =>
        error instanceof Error &&
        /^OAUTH_TEST_/.test(error.message) &&
        !error.message.includes("secret"),
    )
  })
}
test("web环境不继承设施、provider或私人账号凭据", async () => {
  const { publicWebEnvironment } = await import("../scripts/oauth-oidc-local-launcher.mjs")
  const env = publicWebEnvironment(
    { ...valid, PATH: "/bin", PRIVATE_TOKEN: "private", PIGCLAUDE_PROVIDER_SECRET: "secret" },
    "http://127.0.0.1:3",
    "http://127.0.0.1:4",
  )
  assert.equal(env.DATABASE_URL, undefined)
  assert.equal(env.REDIS_URL, undefined)
  assert.equal(env.PRIVATE_TOKEN, undefined)
  assert.equal(env.PIGCLAUDE_PROVIDER_SECRET, undefined)
  assert.equal(env.API_PROXY_TARGET, "http://127.0.0.1:3")
})
test("专用URL仍必须同时提供实际metadata，不能默默选设施", async () => {
  const { startOAuthLauncher } = await import("../scripts/oauth-oidc-local-launcher.mjs")
  await assert.rejects(startOAuthLauncher(valid), /OAUTH_TEST_METADATA_REQUIRED/)
})
