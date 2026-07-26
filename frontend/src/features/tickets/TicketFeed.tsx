import { Receipt } from 'lucide-react'
import { SectionCard } from '@/components/shared/SectionCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTicketFeed } from '@/lib/ticketFeedStore'

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/**
 * worker-service keeps no ticket history of its own (in-memory counter
 * only, see README), so this feed only ever shows what this browser tab
 * has sent via the demo controls. That's enough to give the demo a pulse.
 */
export function TicketFeed() {
  const feed = useTicketFeed()

  return (
    <SectionCard
      icon={<Receipt />}
      title="Live ticket feed"
      description="Every ticket sent from this tab, most recent first."
      tooltip="worker-service doesn't store ticket history itself, this list is just what you've triggered here, so you can see the effect of each demo control immediately."
      contentClassName="p-0"
    >
      {feed.length === 0 ? (
        <p className="text-muted-foreground px-5 pb-5 text-sm">
          No tickets sent yet. Use "Send one ticket" or "Auto-send" below.
        </p>
      ) : (
        <ScrollArea className="h-[180px] px-5 pb-5">
          <ul className="flex flex-col gap-1.5 pr-3">
            {feed.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground shrink-0">{formatTime(entry.at)}</span>
                {entry.error ? (
                  <span className="text-destructive truncate">{entry.error}</span>
                ) : entry.response ? (
                  <>
                    <span className="truncate">
                      #{entry.response.ticket_id} · {entry.response.model}
                    </span>
                    {entry.response.db_broken ? (
                      <StatusBadge tone="destructive">db broken</StatusBadge>
                    ) : (
                      <StatusBadge tone={entry.response.estimated_cost_usd >= 0.5 ? 'warning' : 'success'}>
                        ${entry.response.estimated_cost_usd.toFixed(2)}
                      </StatusBadge>
                    )}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </SectionCard>
  )
}
