// 在实际默认 profile 的普通页面读取生效配置和 ICE 采样，不用启动参数替代观测。

import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { acceptLanguage, resolveTimezone } from "./fingerprint-args"
import {
  EnvironmentBrowserClient,
  record,
  type EnvironmentPage,
} from "./environment-browser-client"
import type { BrowserEnvironmentFacts } from "./environment-check-model"

/** 读取语言、六类 Intl、规范化时区及冬夏偏移；无效值拒绝参与比对。 */
export async function readEnvironmentFacts(
  client: EnvironmentBrowserClient,
  page: EnvironmentPage,
  fingerprint: ClaudeFingerprintView,
): Promise<BrowserEnvironmentFacts> {
  const zone = fingerprint.timezone ? resolveTimezone(fingerprint.timezone) : null
  const value = await client.evaluate(
    page,
    `(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const expectedTimezone = new Intl.DateTimeFormat("en", {timeZone:${JSON.stringify(zone)} ?? timezone}).resolvedOptions().timeZone;
    const dates = [Date.UTC(2026,0,15,12),Date.UTC(2026,6,15,12)];
    const formatter = new Intl.DateTimeFormat("en-US", {timeZone:expectedTimezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
    return {language:navigator.language,languages:[...navigator.languages],
      locales:[Intl.DateTimeFormat,Intl.NumberFormat,Intl.Collator,Intl.PluralRules,Intl.RelativeTimeFormat,Intl.ListFormat].map(type=>new type().resolvedOptions().locale),
      timezone,expectedTimezone,offsets:dates.map(time=>new Date(time).getTimezoneOffset()),
      expectedOffsets:dates.map(time=>{const parts=Object.fromEntries(formatter.formatToParts(time).map(p=>[p.type,p.value]));return (time-Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second))/60000}),
      platform:navigator.platform,hardwareConcurrency:navigator.hardwareConcurrency};
  })()`,
  )
  if (
    !record(value) ||
    typeof value.language !== "string" ||
    !strings(value.languages) ||
    !strings(value.locales) ||
    value.locales.length !== 6 ||
    typeof value.timezone !== "string" ||
    typeof value.expectedTimezone !== "string" ||
    !numbers(value.offsets) ||
    value.offsets.length !== 2 ||
    !numbers(value.expectedOffsets) ||
    value.expectedOffsets.length !== 2 ||
    typeof value.platform !== "string" ||
    typeof value.hardwareConcurrency !== "number" ||
    value.hardwareConcurrency < 1
  )
    throw new Error("浏览器配置证据不完整")
  return value as BrowserEnvironmentFacts
}

/** 比对显式配置和两个实际页面的自动基线，地区标签不静默降级成其他地区。 */
export function environmentSettingsMatch(
  facts: BrowserEnvironmentFacts[],
  fingerprint: ClaudeFingerprintView,
): boolean {
  if (facts.length !== 2 || JSON.stringify(facts[0]) !== JSON.stringify(facts[1])) return false
  const value = facts[0]
  if (!value) return false
  const locale = canonical(fingerprint.lang || value.language)
  const languages = (
    fingerprint.acceptLang ||
    (fingerprint.lang ? acceptLanguage(fingerprint.lang) : value.languages.join(","))
  )
    .split(",")
    .map((item) => canonical(item.trim().split(";")[0] ?? ""))
  const platform = { macos: "MacIntel", windows: "Win32", linux: "Linux x86_64" }[
    fingerprint.platform
  ]
  return (
    locale !== null &&
    canonical(value.language) === locale &&
    value.locales.every((item) => canonical(item) === locale) &&
    JSON.stringify(value.languages.map(canonical)) === JSON.stringify(languages) &&
    value.timezone === value.expectedTimezone &&
    JSON.stringify(value.offsets) === JSON.stringify(value.expectedOffsets) &&
    value.platform === platform &&
    (!fingerprint.hardwareConcurrency ||
      value.hardwareConcurrency === Number(fingerprint.hardwareConcurrency))
  )
}

/** 完成无媒体权限的 DataChannel ICE 采样；超时明确保留未完成。 */
export async function readEnvironmentIce(
  client: EnvironmentBrowserClient,
  page: EnvironmentPage,
  stun: string,
): Promise<{ completed: boolean; candidates: string[] }> {
  const value = await client.evaluate(
    page,
    `new Promise(resolve=>{
    if(typeof RTCPeerConnection!=="function"){resolve({completed:false,candidates:[]});return}
    const peer=new RTCPeerConnection({iceServers:[{urls:${JSON.stringify(stun)}}]});
    const candidates=[];let done=false;
    const finish=completed=>{if(done)return;done=true;clearTimeout(timer);peer.close();resolve({completed,candidates})};
    const timer=setTimeout(()=>finish(false),6000);
    peer.onicecandidate=event=>{if(event.candidate)candidates.push(event.candidate.candidate)};
    peer.onicegatheringstatechange=()=>{if(peer.iceGatheringState==="complete")finish(true)};
    peer.createDataChannel("diagnostic");peer.createOffer().then(offer=>peer.setLocalDescription(offer)).catch(()=>finish(false));
  })`,
  )
  if (!record(value) || typeof value.completed !== "boolean" || !strings(value.candidates))
    throw new Error("ICE 证据不完整")
  return { completed: value.completed, candidates: value.candidates }
}

function canonical(value: string): string | null {
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null
  } catch {
    return null
  }
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string")
}
function numbers(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === "number" && Number.isFinite(item))
  )
}
