// 汇合本次真实浏览器配置、native 网络与独立故障证据，按固定合同生成授权环境报告。

import { isIP } from "node:net"
import { pigbrowserVersion } from "../../../pigbrowser-resources.cjs"
import {
  EnvironmentBrowserClient,
  record,
  type EnvironmentPage,
} from "./environment-browser-client"
import { environmentResponseIp, publicEnvironmentIpv4 } from "./environment-address"
import {
  environmentSettingsMatch,
  readEnvironmentFacts,
  readEnvironmentIce,
} from "./environment-browser-facts"
import {
  environmentPolicyVersion,
  type BrowserEnvironmentFacts,
  type EnvironmentCheckContext,
  type EnvironmentCheckItem,
  type EnvironmentCheckReport,
  type EnvironmentCheckTargets,
  type NativeEnvironmentResponse,
} from "./environment-check-model"
import { environmentBinding, environmentCheckItem, environmentVerdict } from "./environment-policy"
import { inspectClaudeNavigation, inspectProxyFailure } from "./environment-web-probes"
import { localBridgePort, managedCallbackPort } from "./launch-argument-guard"
import { unavailableNativeEvidence } from "./native-environment-evidence"
import { environmentDnsCheck } from "./environment-dns"

/** 从专用管道采集本次实例证据；清理无法确认时抛错，不生成放行报告。 */
export async function inspectAuthorizationEnvironment(
  client: EnvironmentBrowserClient,
  page: EnvironmentPage,
  context: EnvironmentCheckContext,
  targets: EnvironmentCheckTargets,
): Promise<EnvironmentCheckReport> {
  const mode = context.network.mode
  const checks: EnvironmentCheckItem[] = []
  const version = await client.command("Browser.getVersion")
  const expectedVersion = pigbrowserVersion()
  const runtime =
    typeof version.product === "string" &&
    ["Chrome", "Chromium"].some((brand) => version.product === `${brand}/${expectedVersion}`)
  checks.push(
    environmentCheckItem("runtime", mode, runtime ? "passed" : "failed", {
      expected: `完整固定 PigBrowser 开发包；native 内核 ${expectedVersion}`,
      actual: runtime ? "已核对完整包与本次内核版本" : "本次 native 内核版本与固定版本不符",
      evidence: "执行前校验全部资源清单；启动后通过本次进程专用管道读取 Browser.getVersion",
      remedy: runtime ? "无需处理" : "重新准备固定 PigBrowser 开发包",
    }),
  )
  const initialFacts = await readEnvironmentFacts(client, page, context.fingerprint).catch(
    () => undefined,
  )
  const observations = await client.withPage(false, undefined, async (probe) => {
    const primary = await client.network(probe, targets.primaryIp, { navigation: true })
    let actualFacts: BrowserEnvironmentFacts | undefined
    try {
      await client.waitForDocument(probe)
      actualFacts = await readEnvironmentFacts(client, probe, context.fingerprint)
    } catch {
      /* 留为缺证据。 */
    }
    const secondary = await client.network(probe, targets.secondaryIp)
    const dns =
      targets.dnsQuery === undefined
        ? undefined
        : await client.network(probe, targets.dnsQuery, {
            headers: { accept: "application/dns-json" },
          })
    const ice = await readEnvironmentIce(client, probe, targets.stun).catch(() => ({
      completed: false,
      candidates: [],
    }))
    return { primary, secondary, actualFacts, ice, dns }
  })
  const facts =
    initialFacts && observations.actualFacts ? [initialFacts, observations.actualFacts] : []
  const settings = environmentSettingsMatch(facts, context.fingerprint)
  checks.push(
    environmentCheckItem(
      "settings",
      mode,
      facts.length < 2 ? "unknown" : settings ? "passed" : "failed",
      {
        expected: `语言 ${context.fingerprint.lang || "自动（记录实际基线）"}；时区 ${context.fingerprint.timezone || "自动"}；平台 ${context.fingerprint.platform || "自动"}；CPU ${context.fingerprint.hardwareConcurrency || "自动"}`,
        actual: initialFacts
          ? `语言 ${initialFacts.language}；首选 ${initialFacts.languages.join(",")}；Intl ${initialFacts.locales.join(",")}；时区 ${initialFacts.timezone}；冬夏偏移 ${initialFacts.offsets.join(",")}；平台 ${initialFacts.platform}；CPU ${initialFacts.hardwareConcurrency}`
          : "未取得完整配置",
        evidence: `实际默认 profile 的两个普通页面；六类 Intl 默认值、IANA 解析与冬夏偏移${settings ? "一致" : "未通过核对"}`,
        remedy: settings
          ? "自动项保持实际基线，不按 IP 或字体推断设置"
          : "核对保存的指纹和高级启动参数，修正冲突后重新检测",
      },
    ),
  )
  checks.push(...networkChecks(context, observations.primary, observations.secondary, targets))
  checks.push(networkPolicy(context))
  checks.push(
    environmentDnsCheck(
      observations.dns,
      targets.dnsQuery,
      mode,
      context.network.mode === "bound" ? context.network.bridgeUrl : null,
    ),
  )
  const publicCandidates = observations.ice.candidates.filter(candidateHasPublicAddress)
  checks.push(
    environmentCheckItem(
      "webrtc",
      mode,
      mode === "system"
        ? "info"
        : publicCandidates.length
          ? "failed"
          : observations.ice.completed
            ? "passed"
            : "unknown",
      {
        expected:
          mode === "bound"
            ? "ICE 完成且无公网地址候选；禁用非代理 UDP"
            : "记录系统网络的实际 ICE 观测",
        actual: `采样${observations.ice.completed ? "完成" : "未完成"}；公网候选 ${publicCandidates.length}；全部候选 ${observations.ice.candidates.length}`,
        evidence: "实际 profile 的 DataChannel + STUN；未申请摄像头或麦克风；不把超时当作无泄漏",
        remedy:
          mode === "system" || (observations.ice.completed && !publicCandidates.length)
            ? "无需处理"
            : "检查非代理 UDP 策略及 ICE 可达性后重新检测",
      },
    ),
  )
  checks.push(await inspectProxyFailure(client, targets, mode))
  checks.push(await inspectClaudeNavigation(client, targets, mode))
  checks.push(
    ...structuredClone(
      context.request.nativeEvidence?.checks ?? unavailableNativeEvidence(Date.now(), mode).checks,
    ),
  )
  checks.push(
    environmentCheckItem("scope", mode, "info", {
      expected: "只为本轮浏览器配置与所列请求提供证据",
      actual:
        "原生浏览器、本机中转与 CLI 配置检查；CLI 内部 Intl 未确认。系统 DNS 泄漏、整机 UDP/IPv6、文件与管理接口沙箱未覆盖。",
      evidence:
        "本轮采用原生 PigBrowser + 本机 daemon + 账号代理，未运行虚拟机；不输出风险分或封号概率",
      remedy: "真实 Claude 登录由你完成；其他平台与真实 CLI 的验收分别记录",
    }),
  )
  return {
    policy: environmentPolicyVersion,
    runId: context.request.runId,
    binding: environmentBinding({
      ...context,
      nativeBinding: context.request.nativeEvidence?.binding,
    }),
    createdAt: Date.now(),
    networkMode: mode,
    verdict: environmentVerdict(checks, mode),
    checks,
  }
}

function networkChecks(
  context: EnvironmentCheckContext,
  primary: NativeEnvironmentResponse,
  secondary: NativeEnvironmentResponse,
  targets: EnvironmentCheckTargets,
): EnvironmentCheckItem[] {
  const mode = context.network.mode
  const validPrimary = validProbe(primary, targets.primaryIp)
  const validSecondary = validProbe(secondary, targets.secondaryIp)
  const a = validPrimary ? environmentResponseIp(primary.body) : null
  const b = validSecondary ? environmentResponseIp(secondary.body) : null
  const expected =
    mode === "bound"
      ? publicEnvironmentIpv4(context.expectedExitIp)
      : (context.request.nativeEvidence?.exitIp ?? a)
  const complete = a !== null && b !== null && expected !== null
  const matches = complete && a === b && a === expected
  const exit = environmentCheckItem(
    "exit",
    mode,
    !complete ? "unknown" : matches ? "passed" : "failed",
    {
      expected:
        mode === "bound"
          ? "浏览器两个原始探针与本轮桥/上游所测公网 IPv4 一致"
          : "两个原始 IPv4 服务对本次浏览器的观测一致",
      actual: `探针一 ${a ?? "无有效公网 IPv4"}；探针二 ${b ?? "无有效公网 IPv4"}${mode === "bound" ? `；本轮网络探针 ${expected ?? "缺失"}` : ""}`,
      evidence: `native Network 响应体；HTTP ${primary.status}/${secondary.status}；未使用页面自报 IP；目标/缓存/SW/TLS ${validPrimary && validSecondary ? "核对正常" : "缺少有效证据"}`,
      remedy: matches ? "无需处理" : "核对当前代理出口或探针可达性；缺证据时重新检测",
    },
  )
  const port = mode === "bound" ? localBridgePort(context.network.bridgeUrl) : null
  const routed =
    port !== null &&
    [primary, secondary].every(
      (probe) => probe.peerAddress === "127.0.0.1" && probe.peerPort === port,
    )
  const route = environmentCheckItem(
    "proxy-route",
    mode,
    mode === "system" ? "info" : routed ? "passed" : "unknown",
    {
      expected:
        mode === "bound" ? "两个所测浏览器连接均到达本次 Xray 本机端口" : "本轮使用系统网络",
      actual:
        mode === "system"
          ? "不要求应用内代理入口"
          : routed
            ? "两条 native 连接均匹配本次入口"
            : "未确认两条连接均匹配本次入口",
      evidence:
        "逐项核对 native remoteIPAddress/remotePort 与本轮 Xray 实例；不把 IP 相同当作连接路径证明",
      remedy:
        mode === "system" || routed
          ? "无需处理"
          : "检查本轮 Xray 入口、浏览器代理策略及 native 连接元数据",
    },
  )
  let location = "未取得同一公网 IP 的资料"
  if (matches) {
    try {
      const metadata: unknown = JSON.parse(secondary.body)
      if (record(metadata))
        location = `国家代码 ${typeof metadata.country_code === "string" ? metadata.country_code.slice(0, 8) : "未知"}；ASN ${typeof metadata.asn === "number" ? metadata.asn : "未知"}`
    } catch {
      /* 位置资料不决定放行。 */
    }
  }
  return [
    exit,
    route,
    environmentCheckItem("location", mode, "info", {
      expected: "仅记录与两个已核对出口相同 IP 的资料",
      actual: location,
      evidence:
        "第二个原始 caller-IP 服务的同次响应；不混入其他服务器 IP，不以 ASN、字体或 Emoji 计算风险",
      remedy: "数据库资料仅作说明，不推断物理线路，不自动修改地区或指纹",
    }),
  ]
}

function validProbe(value: NativeEnvironmentResponse, expectedUrl: string): boolean {
  return (
    value.status === 200 &&
    !value.error &&
    !value.fromCache &&
    !value.fromServiceWorker &&
    value.url === expectedUrl &&
    (!expectedUrl.startsWith("https:") || value.secure)
  )
}

function networkPolicy(context: EnvironmentCheckContext): EnvironmentCheckItem {
  const mode = context.network.mode
  const args = context.launchArgs
  const port = mode === "bound" ? managedCallbackPort(context.network.callbackUri) : null
  const passed =
    mode === "bound" &&
    args.includes(`--proxy-server=${context.network.bridgeUrl}`) &&
    args.includes(`--proxy-bypass-list=<-loopback>;http://localhost:${port}`) &&
    args.includes("--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1") &&
    args.includes("--disable-non-proxied-udp")
  return environmentCheckItem(
    "network-policy",
    mode,
    mode === "system" ? "info" : passed ? "passed" : "failed",
    {
      expected: "绑定代理时精确回调例外、远端域名解析配置、禁用非代理 UDP；保留 TLS 校验",
      actual:
        mode === "system"
          ? "系统网络，无应用内代理覆盖"
          : passed
            ? "本次启动参数与受管策略一致"
            : "本次网络策略缺失或冲突",
      evidence:
        "本次实际传给内核的参数；DNS 规则不等同独立 DNS 泄漏测量；TLS 不安全参数在启动前拒绝",
      remedy: mode === "system" || passed ? "无需处理" : "移除冲突参数并恢复受管网络设置",
    },
  )
}

function candidateHasPublicAddress(value: string): boolean {
  const parts = value.split(/\s+/)
  const related = parts.indexOf("raddr")
  const addresses = [parts[4], ...(related >= 0 ? [parts[related + 1]] : [])].filter(
    (item): item is string => item !== undefined,
  )
  return addresses.some(
    (ip) =>
      publicEnvironmentIpv4(ip) !== null ||
      (isIP(ip) === 6 && !/^(::(?:1)?$|f[cd]|fe[89ab])/i.test(ip)),
  )
}
