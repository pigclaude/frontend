// 把插件安装时获准的能力限制在当次工具调用或用户触发的命令内。

import type { CapabilityPluginManager, CapabilityPluginSnapshot } from "./capability-plugin-manager"
import type { CapabilityPluginSecrets } from "./capability-plugin-secrets"
import { CapabilityPluginStorage } from "./capability-plugin-storage"
import { readCapabilityPluginWorkspaceText } from "./capability-plugin-workspace"
import {
  PluginSandboxError,
  type PluginSandboxCapabilityMethod,
  type PluginSandboxCapabilityScope,
  type PluginSandboxJson,
} from "./plugin-sandbox-contract"

/** 主进程从安装记录和可信调用方提供的上下文。 */
export type CapabilityPluginScopeOptions = {
  snapshot: CapabilityPluginSnapshot
  manager: Pick<CapabilityPluginManager, "runCapability">
  secrets: Pick<CapabilityPluginSecrets, "read" | "write">
  workspace: string | null
  userDataPath: string
  notify: (message: string) => boolean
  insertText?: (text: string) => boolean
}

type CapabilityOperation = (
  args: readonly PluginSandboxJson[],
  assertCurrent: () => void,
) => PluginSandboxJson | Promise<PluginSandboxJson>

const maximumKeyBytes = 128
const maximumSecretLength = 4_096
const maximumInsertLength = 16_384

/** 创建一次调用的白名单和请求入口。 */
export function createCapabilityPluginScope({
  snapshot,
  manager,
  secrets,
  workspace,
  userDataPath,
  notify,
  insertText,
}: CapabilityPluginScopeOptions): PluginSandboxCapabilityScope {
  const { manifest, revision, dataDirectory } = snapshot
  const { id } = manifest
  const permissions = new Set(manifest.permissions)
  const operations = new Map<
    PluginSandboxCapabilityMethod,
    {
      arity: number
      execute: CapabilityOperation
    }
  >()
  if (permissions.has("storage")) {
    const storage = new CapabilityPluginStorage(userDataPath, dataDirectory)
    operations.set("storage.get", { arity: 1, execute: ([key]) => storage.get(storageKey(key)) })
    operations.set("storage.set", {
      arity: 2,
      execute: ([key, value], assertCurrent) => {
        if (value === undefined) throw denied()
        return storage.change(storageKey(key), value, assertCurrent)
      },
    })
    operations.set("storage.delete", {
      arity: 1,
      execute: ([key], assertCurrent) => storage.change(storageKey(key), undefined, assertCurrent),
    })
  }
  if (permissions.has("secrets")) {
    operations.set("secrets.get", {
      arity: 1,
      execute: ([key]) => secrets.read(id, storageKey(key)),
    })
    operations.set("secrets.set", {
      arity: 2,
      async execute([key, value], assertCurrent) {
        const secret = stringValue(value)
        if (secret.length > maximumSecretLength) throw denied()
        await secrets.write(id, storageKey(key), secret, assertCurrent)
        return null
      },
    })
    operations.set("secrets.delete", {
      arity: 1,
      async execute([key], assertCurrent) {
        await secrets.write(id, storageKey(key), null, assertCurrent)
        return null
      },
    })
  }
  if (workspace !== null && permissions.has("workspace-read")) {
    operations.set("workspace.readText", {
      arity: 1,
      execute: ([path], assertCurrent) =>
        readCapabilityPluginWorkspaceText(
          workspace,
          userDataPath,
          stringValue(path),
          assertCurrent,
        ),
    })
  }
  if (permissions.has("notifications")) {
    operations.set("notifications.show", {
      arity: 1,
      execute: ([message]) => notify(stringValue(message)),
    })
  }
  if (workspace === null && insertText !== undefined && permissions.has("composer-insert")) {
    operations.set("composer.insert", {
      arity: 1,
      execute([value]) {
        const text = stringValue(value)
        if (text.length === 0 || text.length > maximumInsertLength) throw denied()
        return insertText(text)
      },
    })
  }

  return {
    methods: Object.freeze([...operations.keys()]),
    async request(method, args, signal) {
      const operation = operations.get(method)
      if (!operation || args.length !== operation.arity) throw denied()
      try {
        return await manager.runCapability(id, revision, signal, (assertCurrent) =>
          operation.execute(args, assertCurrent),
        )
      } catch (error) {
        if (error instanceof PluginSandboxError) throw error
        throw denied()
      }
    },
  }
}

function stringValue(value: PluginSandboxJson | undefined): string {
  if (typeof value !== "string") throw denied()
  return value
}

function storageKey(value: PluginSandboxJson | undefined): string {
  const key = stringValue(value)
  if (key.length === 0 || Buffer.byteLength(key) > maximumKeyBytes) throw denied()
  return key
}

function denied() {
  return new PluginSandboxError("PLUGIN_CAPABILITY_DENIED")
}
