// 负责提供 Rust 与 TypeScript 共享的第一阶段 JSON contract fixture。

import type { MembershipView } from "../membership"
import canonicalFixtures from "./phase1-contract-fixtures.json"

/** 第一阶段会员视图 fixture，保证可空字段和 decimal string 语义稳定。 */
export const membershipFixture: MembershipView = canonicalFixtures.membership as MembershipView

/** 非空等级 fixture 与 Rust 共用同一份 canonical JSON。 */
export const membershipWithTierFixture: MembershipView =
  canonicalFixtures.membershipWithTier as MembershipView

/** 第一阶段跨语言 fixture 集合，供契约测试统一导入。 */
export const phase1ContractFixtures = {
  membership: membershipFixture,
  membershipWithTier: membershipWithTierFixture,
} as const
