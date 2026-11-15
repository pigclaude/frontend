// 校验能力插件结构、版本范围、工具和声明式贡献；这里只解析 JSON 数据。

import { satisfies, valid, validRange } from "semver"
import { z } from "zod"
import {
  capabilityPluginApiVersion,
  type CapabilityPluginManifest,
} from "../../capability-plugin-contract"
import { isCapabilityPluginId, isCapabilityPluginModulePath } from "./capability-plugin-paths"
import { isProhibitedPluginDomain, normalizePluginNetworkDomain } from "./plugin-network-domains"

const text = (max: number) => z.string().trim().min(1).max(max)
const name = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
  .refine((value) => !["constructor", "prototype"].includes(value))

const tool = z.strictObject({
  name,
  description: text(1_000),
  inputSchema: z.record(z.string(), z.json()).refine((schema) => {
    const { required, properties } = schema
    return (
      schema.type === "object" &&
      (properties === undefined ||
        (properties !== null && typeof properties === "object" && !Array.isArray(properties))) &&
      (required === undefined ||
        (Array.isArray(required) &&
          required.every((key) => typeof key === "string") &&
          new Set(required).size === required.length))
    )
  }),
})

const settingFields = {
  key: name,
  label: text(120),
  description: text(500).optional(),
  required: z.boolean().optional(),
}
const setting = z.discriminatedUnion("type", [
  z.strictObject({
    ...settingFields,
    type: z.literal("text"),
    defaultValue: z.string().max(4_096).optional(),
  }),
  z.strictObject({ ...settingFields, type: z.literal("secret") }),
  z.strictObject({
    ...settingFields,
    type: z.literal("boolean"),
    defaultValue: z.boolean().optional(),
  }),
  z.strictObject({
    ...settingFields,
    type: z.literal("number"),
    defaultValue: z.number().optional(),
  }),
  z.strictObject({
    ...settingFields,
    type: z.literal("select"),
    options: z
      .array(z.strictObject({ label: text(120), value: text(256) }))
      .min(1)
      .max(50),
    defaultValue: text(256).optional(),
  }),
])
const command = z.strictObject({
  id: name,
  title: text(120),
  description: text(500).optional(),
  slash: z
    .string()
    .regex(/^\/[a-z][a-z0-9_-]{0,47}$/)
    .optional(),
})
const permission = z.enum([
  "workspace-read",
  "storage",
  "secrets",
  "notifications",
  "composer-insert",
  "network",
])
const manifest = z.strictObject({
  apiVersion: z.literal(capabilityPluginApiVersion),
  id: z.string().refine(isCapabilityPluginId),
  name: text(120),
  version: text(64).refine((version) => valid(version) !== null),
  pigclaudeVersion: text(200).refine((range) => validRange(range) !== null),
  entry: z.string().refine(isCapabilityPluginModulePath),
  description: text(1_000).optional(),
  tools: z.array(tool).max(50).default([]),
  permissions: z.array(permission).max(6).default([]),
  networkDomains: z.array(text(253)).max(32).default([]),
  settings: z.array(setting).max(50).default([]),
  commands: z.array(command).max(30).default([]),
  toolResultTemplates: z
    .array(z.strictObject({ tool: name, template: text(4_096) }))
    .max(50)
    .default([]),
})

/** 重新读取清单结构与安全策略，升级宿主后仍可展示不兼容的已安装插件。 */
export function parseCapabilityPluginManifest(input: unknown): CapabilityPluginManifest {
  if (
    input &&
    typeof input === "object" &&
    "apiVersion" in input &&
    typeof input.apiVersion === "number" &&
    input.apiVersion !== capabilityPluginApiVersion
  )
    throw new Error("PLUGIN_API_UNSUPPORTED")
  const parsed = manifest.safeParse(input)
  if (!parsed.success) throw new Error("PLUGIN_MANIFEST_INVALID")
  const value = parsed.data
  const domains = value.networkDomains.map((domain) => {
    const normalized = normalizePluginNetworkDomain(domain)
    if (normalized === null || isProhibitedPluginDomain(normalized))
      throw new Error("PLUGIN_DOMAIN_INVALID")
    return normalized
  })
  if (!unique(domains) || domains.length > 0 !== value.permissions.includes("network"))
    throw new Error("PLUGIN_DOMAIN_INVALID")
  const toolNames = value.tools.map(({ name }) => name)
  if (
    !unique(toolNames) ||
    !unique(value.permissions) ||
    !unique(value.settings.map(({ key }) => key)) ||
    !unique(value.commands.map(({ id }) => id)) ||
    !unique(value.commands.flatMap(({ slash }) => (slash === undefined ? [] : [slash]))) ||
    !unique(value.toolResultTemplates.map(({ tool }) => tool)) ||
    value.toolResultTemplates.some(({ tool }) => !toolNames.includes(tool))
  )
    throw new Error("PLUGIN_MANIFEST_INVALID")
  for (const field of value.settings) {
    if (field.type === "secret" && !value.permissions.includes("secrets"))
      throw new Error("PLUGIN_MANIFEST_INVALID")
    if (field.type !== "select") continue
    const options = field.options.map(({ value }) => value)
    if (
      !unique(options) ||
      (field.defaultValue !== undefined && !options.includes(field.defaultValue))
    )
      throw new Error("PLUGIN_MANIFEST_INVALID")
  }
  return { ...value, networkDomains: domains }
}

/** 判断已解析的范围是否允许当前运行版本。 */
export function isCapabilityPluginCompatible(
  value: CapabilityPluginManifest,
  appVersion: string,
): boolean {
  return satisfies(appVersion, value.pigclaudeVersion)
}

/** 安装前同时验证清单和当前宿主版本。 */
export function validateCapabilityPluginManifest(
  input: unknown,
  appVersion: string,
): CapabilityPluginManifest {
  const value = parseCapabilityPluginManifest(input)
  if (!isCapabilityPluginCompatible(value, appVersion))
    throw new Error("PLUGIN_VERSION_INCOMPATIBLE")
  return value
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}
