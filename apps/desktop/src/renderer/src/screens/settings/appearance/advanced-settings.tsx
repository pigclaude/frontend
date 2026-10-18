// 负责「高级 ›」折叠区：左侧展开开关（展开状态写回设置），右侧「重置为默认设置」，下面是各组高级设置。
import { Icon } from "../../../components/icon"
import { Button } from "../../../components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../components/ui/collapsible"
import type { AppearanceController } from "../../../hooks/use-appearance"
import { AdvancedBehavior } from "./advanced-behavior"
import { AdvancedLook } from "./advanced-look"

/** 渲染高级区；默认收起，展开与否保存在 advancedOpen。点重置只调用 onReset，确认由调用方负责。 */
export function AdvancedSettings({
  appearance,
  glassAvailable,
  platform,
  onReset,
}: {
  appearance: AppearanceController
  glassAvailable: boolean
  platform: string
  onReset: () => void
}) {
  const { settings, update } = appearance
  return (
    <Collapsible
      open={settings.advancedOpen}
      onOpenChange={(open) => update((current) => ({ ...current, advancedOpen: open }))}
    >
      <div className="section-head adv-bar">
        <CollapsibleTrigger asChild>
          <Button variant="plain" className="adv-toggle">
            高级
            <Icon name={settings.advancedOpen ? "down" : "right"} small />
          </Button>
        </CollapsibleTrigger>
        <Button variant="plain" className="adv-reset" onClick={onReset}>
          重置为默认设置
        </Button>
      </div>
      <CollapsibleContent>
        <AdvancedLook appearance={appearance} glassAvailable={glassAvailable} />
        <AdvancedBehavior appearance={appearance} platform={platform} />
      </CollapsibleContent>
    </Collapsible>
  )
}
