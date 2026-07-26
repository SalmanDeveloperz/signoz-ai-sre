import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { cn } from '@/lib/utils'
import { useServiceStatus } from './useServiceStatus'

/** Compact "are all 3 services up" strip, meant to sit in the page header
 * so a presenter can confirm everything is healthy before starting. */
export function StatusStrip() {
  const services = useServiceStatus()

  return (
    <div className="flex items-center gap-3 rounded-full border border-border bg-card/60 px-3 py-1.5">
      {services.map((service) => (
        <div key={service.name} className="flex items-center gap-1.5">
          <span
            className={cn(
              'size-2 rounded-full',
              service.loading ? 'bg-muted-foreground/40 animate-pulse' : service.up ? 'bg-success' : 'bg-destructive'
            )}
            aria-hidden="true"
          />
          <span className="text-xs font-medium">{service.name}</span>
        </div>
      ))}
      <InfoTooltip side="bottom">
        Live health of the 3 backend services, checked every 5s. A red dot means the port
        isn't responding, check that `docker compose up -d` finished successfully.
      </InfoTooltip>
    </div>
  )
}
