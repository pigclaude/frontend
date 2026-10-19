// 负责验证稳定设备身份贯通主进程组合和真实授权请求，失败时不触网。
import { describe, expect, it, vi } from "vitest"
import { createDesktopComposition } from "./composition"
import { DeviceIdentityService } from "./device-identity"
import { AuthorizationService } from "./authorization/service"
import { deferred, profileApi, ProfileVault } from "./testing/profile-fixture"

const raw = "01234567-89AB-CDEF-0123-456789ABCDEF"
const deviceId = "pcd_77d95e81bc3fd6401209110cb1e22cc2961ec055ad4c95cfe63e51b6cefec0c2"
const request = { purpose: "pigclaude-login", mode: "login" } as const
const redirect = "http://127.0.0.1:43123/oauth/callback"
const identity = () =>
  new DeviceIdentityService({ read: async () => ({ platform: "darwin", machineId: raw }) })

describe("device identity first-party entries", () => {
  it("sends the derived identity across fresh profiles and ignores old vault identities", async () => {
    const sent: unknown[] = []
    const prepareDeviceAuthorization = async (
      input: Parameters<ReturnType<typeof profileApi>["prepareDeviceAuthorization"]>[0],
    ) => {
      sent.push(input)
      return {
        contextId: "context",
        authorizationUrl: "http://127.0.0.1:8788/authorize/flow",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }
    }
    for (const account of ["one", "two"]) {
      const vault = new ProfileVault()
      await vault.set("device:identity", JSON.stringify({ deviceId: account, machineId: raw }))
      const composition = createDesktopComposition({
        vault,
        authOrigin: "http://127.0.0.1:8788",
        deviceIdentity: identity(),
        api: profileApi({ prepareDeviceAuthorization }),
      })
      await composition.authorizationService.start(request, redirect)
      await composition.dispose()
    }
    expect(sent).toHaveLength(2)
    for (const payload of sent) expect(payload).toMatchObject({ deviceId, platform: "darwin" })
    expect(JSON.stringify(sent)).not.toContain(raw)
  })
  it("rejects before a network request when platform identity is unavailable", async () => {
    const prepareDeviceAuthorization = vi.fn()
    const composition = createDesktopComposition({
      vault: new ProfileVault(),
      authOrigin: "http://127.0.0.1:8788",
      deviceIdentity: new DeviceIdentityService({
        read: async () => {
          throw new Error(raw)
        },
      }),
      api: profileApi({ prepareDeviceAuthorization }),
    })
    await expect(composition.authorizationService.start(request, redirect)).rejects.toThrow(
      "DEVICE_ID_UNAVAILABLE",
    )
    expect(prepareDeviceAuthorization).not.toHaveBeenCalled()
    expect(composition.authorizationService.getActiveSession()).toBeNull()
    await composition.dispose()
  })
  it("does not start a remote authorization after sign-out invalidates a pending identity read", async () => {
    const reading = deferred<void>()
    const release = deferred<void>()
    const prepareDeviceAuthorization = vi.fn()
    const service = new AuthorizationService({
      authOrigin: "http://127.0.0.1:8788",
      vault: new ProfileVault(),
      exchangeCode: async () => {
        throw new Error("unused")
      },
      deviceIdentity: {
        read: async () => {
          reading.resolve(undefined)
          await release.promise
          return { deviceId, platform: "darwin" }
        },
      },
      startAuthorization: prepareDeviceAuthorization,
    })
    const pending = service.start(request, redirect).catch((error: unknown) => error)
    await reading.promise
    await service.suspend()
    release.resolve(undefined)
    expect(await pending).toMatchObject({ status: "cancelled" })
    expect(prepareDeviceAuthorization).not.toHaveBeenCalled()
  })
})
