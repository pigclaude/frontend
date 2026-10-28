// 负责页面发码尝试的同步排他，以及邮箱草稿、交互和组件生命周期的结果归属。
"use client"

import { useLayoutEffect, useRef } from "react"
import type { IdentityInteraction } from "@/lib/identity-api"

/** 一次取得入口的发码尝试，只有原目标仍有效时才允许写回页面。 */
export interface EmailCodeAttempt {
  /** 原邮箱、交互及组件仍有效，而且本尝试仍持有入口时返回真。 */
  ownsResult(): boolean
  /** 只释放本尝试持有的入口，旧清理不会释放之后的尝试。 */
  release(): void
}

/** 同步取得单组件发码入口；目标变化或卸载会撤销已开始尝试的结果归属。 */
export function useEmailCodeRequestOwner(
  interaction: IdentityInteraction,
  email: string,
): () => EmailCodeAttempt | null {
  const generation = useRef(0)
  const active = useRef<symbol | null>(null)
  const mounted = useRef(false)

  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
    }
  }, [email, interaction.interactionId, interaction.realm, interaction.csrf])

  return () => {
    if (!mounted.current || active.current !== null) return null
    const current = generation.current
    const owner = Symbol()
    active.current = owner
    return {
      ownsResult: () =>
        mounted.current && generation.current === current && active.current === owner,
      release: () => {
        if (active.current === owner) active.current = null
      },
    }
  }
}
