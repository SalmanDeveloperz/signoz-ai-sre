import { SlidersHorizontal } from 'lucide-react'
import { SectionCard } from '@/components/shared/SectionCard'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { useSettings, useUpdateSetting } from './useSettings'

const MODEL_OPTIONS = [
  { value: 'gpt-standard', label: 'gpt-standard', hint: 'The expensive default. Costly while a cost spike is active.' },
  { value: 'gpt-cheap', label: 'gpt-cheap', hint: 'The fix for Failure B: same tickets, low reported cost.' },
]

/**
 * The 3 shared switches from CONTRACTS.md Section 1. This panel is the
 * "proof" surface of the whole demo: watch a value here flip on its own,
 * seconds after triggering a failure, with no page reload.
 */
export function SettingsPanel() {
  const { data: settings, isLoading } = useSettings()
  const updateSetting = useUpdateSetting()

  if (isLoading || !settings) {
    return (
      <SectionCard icon={<SlidersHorizontal />} title="Control-plane settings" description="Loading live settings...">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </SectionCard>
    )
  }

  return (
    <SectionCard
      icon={<SlidersHorizontal />}
      title="Control-plane settings"
      description="Refreshes every 2s. This is what the agent changes when it fixes something."
      tooltip="These 3 switches are the only shared state in the system. worker-service reads them before every ticket; watcher-service is the only automated caller that changes them, but you can override any of them here too, exactly like a human operator would."
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <Checkbox
            id="use_backup_data"
            checked={settings.use_backup_data}
            disabled={updateSetting.isPending}
            onCheckedChange={(checked) =>
              updateSetting.mutate({ key: 'use_backup_data', value: checked === true })
            }
          />
          <div className="grid gap-0.5 leading-none">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="use_backup_data" className="cursor-pointer">
                use_backup_data
              </Label>
              <InfoTooltip>
                The fix for Failure A (database outage). When on, worker-service skips the broken
                lookup and answers from a cached backup instead, so tickets stop failing.
              </InfoTooltip>
            </div>
            <span className="text-muted-foreground text-xs">
              {settings.use_backup_data ? 'On: serving cached data' : 'Off: using the live lookup'}
            </span>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id="retry_enabled"
            checked={settings.retry_enabled}
            disabled={updateSetting.isPending}
            onCheckedChange={(checked) =>
              updateSetting.mutate({ key: 'retry_enabled', value: checked === true })
            }
          />
          <div className="grid gap-0.5 leading-none">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="retry_enabled" className="cursor-pointer">
                retry_enabled
              </Label>
              <InfoTooltip>
                Whether worker-service retries once before giving up on a failed lookup. Exists
                mainly to demonstrate the safety check: turning this off while use_backup_data is
                on gets blocked automatically.
              </InfoTooltip>
            </div>
            <span className="text-muted-foreground text-xs">
              {settings.retry_enabled ? 'On: retries once on failure' : 'Off: fails immediately'}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">active_model</span>
            <InfoTooltip>
              The fix for Failure B (cost spike). Controls which simulated model worker-service
              reports using, which in turn controls the fake per-ticket cost.
            </InfoTooltip>
          </div>
          <RadioGroup
            value={settings.active_model}
            onValueChange={(value) => updateSetting.mutate({ key: 'active_model', value })}
            disabled={updateSetting.isPending}
            className="gap-2"
          >
            {MODEL_OPTIONS.map((opt) => (
              <div key={opt.value} className="flex items-center gap-2.5">
                <RadioGroupItem value={opt.value} id={`model-${opt.value}`} />
                <Label htmlFor={`model-${opt.value}`} className="cursor-pointer font-normal">
                  <span className="font-mono text-sm">{opt.label}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{opt.hint}</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      </div>
    </SectionCard>
  )
}
