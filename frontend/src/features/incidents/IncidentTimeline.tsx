import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { SectionCard } from '@/components/shared/SectionCard'
import { SearchBar } from '@/components/shared/SearchBar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useIncidents } from './useIncidents'
import { IncidentCard } from './IncidentCard'

export function IncidentTimeline() {
  const { data: incidents, isLoading } = useIncidents()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!incidents) return []
    const q = search.trim().toLowerCase()
    if (!q) return incidents
    return incidents.filter((incident) =>
      [incident.detected_via, incident.diagnosis, incident.action_taken, incident.safety_check_result]
        .join(' ')
        .toLowerCase()
        .includes(q)
    )
  }, [incidents, search])

  return (
    <SectionCard
      icon={<History />}
      title="Incident timeline"
      description="Refreshes every 2s. The permanent audit log, every automated action, allowed or blocked."
      tooltip="Every alert watcher-service handles gets a row here, whether a fix was applied, blocked by the safety check, or Tier 2 found no evidence to act on. Nothing is silently dropped."
      action={
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Filter incidents..."
          aria-label="Filter incidents by diagnosis, action, or source"
        />
      }
      contentClassName="p-0"
    >
      {isLoading ? (
        <div className="flex flex-col gap-2 px-5 pb-5">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground px-5 pb-5 text-sm">
          {incidents && incidents.length > 0
            ? 'No incidents match your search.'
            : 'No incidents yet. Trigger a failure below to see the agent respond here.'}
        </p>
      ) : (
        <ScrollArea className="h-[420px] px-5 pb-5">
          <ul className="flex flex-col gap-2.5 pr-3">
            {filtered.map((incident) => (
              <IncidentCard key={incident.id} incident={incident} />
            ))}
          </ul>
        </ScrollArea>
      )}
    </SectionCard>
  )
}
