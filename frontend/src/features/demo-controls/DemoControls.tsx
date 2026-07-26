import { useEffect, useState } from 'react'
import { DatabaseZap, Wrench, TrendingUp, TrendingDown, Send, Sparkles, Wand2 } from 'lucide-react'
import { SectionCard } from '@/components/shared/SectionCard'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  useBreakDb,
  useFixDb,
  useSpikeCost,
  useFixCost,
  useSendTicket,
  useTriggerUnrecognizedAlert,
} from './useDemoControls'

interface ControlButtonProps {
  label: string
  tooltip: string
  icon: React.ReactNode
  variant?: React.ComponentProps<typeof Button>['variant']
  onClick: () => void
  isPending: boolean
}

function ControlButton({ label, tooltip, icon, variant = 'outline', onClick, isPending }: ControlButtonProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Button variant={variant} size="sm" className="gap-1.5" onClick={onClick} disabled={isPending}>
        {icon}
        {label}
      </Button>
      <InfoTooltip>{tooltip}</InfoTooltip>
    </div>
  )
}

/**
 * Every button here maps to exactly one endpoint documented in README
 * Section 6, so this panel is a literal, clickable version of the
 * Quickstart walkthrough, no terminal required (FR-UI-03, FR-UI-05).
 */
export function DemoControls() {
  const breakDb = useBreakDb()
  const fixDb = useFixDb()
  const spikeCost = useSpikeCost()
  const fixCost = useFixCost()
  const sendTicket = useSendTicket()
  const triggerAlert = useTriggerUnrecognizedAlert()

  const [autoSend, setAutoSend] = useState(false)

  useEffect(() => {
    if (!autoSend) return
    const interval = setInterval(() => sendTicket.mutate(), 1000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend])

  return (
    <SectionCard
      icon={<Wand2 />}
      title="Demo controls"
      description="Trigger every scenario this system handles, live."
      tooltip="These buttons call the same debug/demo endpoints documented in the README, they exist purely to make this system's behavior visible without a terminal."
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
            Failure A · database outage
          </p>
          <div className="flex flex-wrap gap-2">
            <ControlButton
              label="Break DB"
              variant="destructive"
              icon={<DatabaseZap className="size-4" />}
              tooltip="Marks the simulated database as broken. Ticket requests start failing (503, db_broken: true) until fixed or worked around."
              onClick={() => breakDb.mutate()}
              isPending={breakDb.isPending}
            />
            <ControlButton
              label="Fix DB"
              icon={<Wrench className="size-4" />}
              tooltip="Repairs the simulated database directly, bypassing the agent. Useful for resetting between demo runs."
              onClick={() => fixDb.mutate()}
              isPending={fixDb.isPending}
            />
          </div>
        </div>

        <Separator />

        <div>
          <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
            Failure B · cost spike
          </p>
          <div className="flex flex-wrap gap-2">
            <ControlButton
              label="Spike cost"
              variant="destructive"
              icon={<TrendingUp className="size-4" />}
              tooltip="Turns on the cost-spike condition. Tickets handled with the active_model still set to gpt-standard will report a high estimated_cost_usd."
              onClick={() => spikeCost.mutate()}
              isPending={spikeCost.isPending}
            />
            <ControlButton
              label="Fix cost"
              icon={<TrendingDown className="size-4" />}
              tooltip="Turns the cost-spike condition back off directly, bypassing the agent."
              onClick={() => fixCost.mutate()}
              isPending={fixCost.isPending}
            />
          </div>
        </div>

        <Separator />

        <div>
          <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">Ticket traffic</p>
          <div className="flex flex-wrap items-center gap-3">
            <ControlButton
              label="Send one ticket"
              icon={<Send className="size-4" />}
              tooltip="Sends one simulated support ticket to worker-service. Watch the ticket feed panel and the settings above for the effect."
              onClick={() => sendTicket.mutate()}
              isPending={sendTicket.isPending}
            />
            <div className="flex items-center gap-2">
              <Switch id="auto-send" checked={autoSend} onCheckedChange={setAutoSend} />
              <Label htmlFor="auto-send" className="cursor-pointer text-sm font-normal">
                Auto-send (1/sec)
              </Label>
              <InfoTooltip>
                SigNoz's real alert rules need a few minutes of sustained traffic to evaluate against
                (a 5-minute rolling window). Leave this on while a failure is active to make the alert
                fire on its own, exactly like production traffic would.
              </InfoTooltip>
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
            Tier 2 · unrecognized alert
          </p>
          <ControlButton
            label="Trigger unrecognized alert"
            icon={<Sparkles className="size-4" />}
            tooltip="Posts a synthetic alert named 'high-latency-alert' directly to watcher-service's webhook, matching neither known Tier 1 pattern. Forces the LLM investigation path (Tier 2) to run."
            onClick={() => triggerAlert.mutate()}
            isPending={triggerAlert.isPending}
          />
        </div>
      </div>
    </SectionCard>
  )
}
