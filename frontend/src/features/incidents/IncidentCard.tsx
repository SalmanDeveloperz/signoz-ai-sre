import { Ban, CheckCircle2, ExternalLink, Sparkles, Zap } from 'lucide-react'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Button } from '@/components/ui/button'
import { inferTier, type Incident } from '@/lib/types'

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function IncidentCard({ incident }: { incident: Incident }) {
  const tier = inferTier(incident)
  const signozUrl = 'http://localhost:8080/traces-explorer'

  return (
    <li className="border-border bg-card/60 flex flex-col gap-2.5 rounded-lg border p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {tier === 'tier-1' ? (
            <StatusBadge tone="muted" icon={<Zap className="size-3" />}>
              Tier 1 · instant
            </StatusBadge>
          ) : (
            <StatusBadge tone="primary" icon={<Sparkles className="size-3" />}>
              Tier 2 · AI investigated
            </StatusBadge>
          )}
          {incident.safety_check_result === 'allowed' ? (
            <StatusBadge tone="success" icon={<CheckCircle2 className="size-3" />}>
              Allowed
            </StatusBadge>
          ) : (
            <StatusBadge tone="destructive" icon={<Ban className="size-3" />}>
              Blocked
            </StatusBadge>
          )}
        </div>
        <span className="text-muted-foreground text-xs whitespace-nowrap">{formatTime(incident.started_at)}</span>
      </div>

      <p className="text-sm leading-snug">{incident.diagnosis}</p>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>
          detected via <span className="text-foreground font-mono">{incident.detected_via}</span>
        </span>
        <span>
          action <span className="text-foreground font-mono">{incident.action_taken}</span>
        </span>
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="text-muted-foreground text-xs">Incident #{incident.id}</span>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" asChild>
          <a href={signozUrl} target="_blank" rel="noreferrer">
            Open in SigNoz
            <ExternalLink className="size-3" />
          </a>
        </Button>
        <InfoTooltip side="left" className="ml-1">
          Opens SigNoz's Traces explorer. Search for spans around {formatTime(incident.started_at)} to see the
          actual trace, for Tier 2 incidents look for a span named investigate.tier2.
        </InfoTooltip>
      </div>
    </li>
  )
}
