import { ExternalLink, Radar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusStrip } from '@/features/status/StatusStrip'
import { GuideDialog } from './GuideDialog'

export function PageHeader() {
  return (
    <header className="border-border bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary/15 text-primary flex size-9 items-center justify-center rounded-lg">
            <Radar className="size-5" />
          </div>
          <div>
            <h1 className="text-base leading-tight font-semibold">AI SRE Console</h1>
            <p className="text-muted-foreground text-xs leading-tight">
              Self-healing infrastructure, observed through SigNoz
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <StatusStrip />
          <GuideDialog />
          <Button variant="outline" size="sm" className="gap-1.5" asChild>
            <a href="http://localhost:8080" target="_blank" rel="noreferrer">
              SigNoz
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>
    </header>
  )
}
