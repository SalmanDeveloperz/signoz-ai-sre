import { PageHeader } from '@/components/shared/PageHeader'
import { SettingsPanel } from '@/features/settings/SettingsPanel'
import { IncidentTimeline } from '@/features/incidents/IncidentTimeline'
import { DemoControls } from '@/features/demo-controls/DemoControls'
import { TicketFeed } from '@/features/tickets/TicketFeed'

function App() {
  return (
    <div className="min-h-svh">
      <PageHeader />
      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-1">
            <SettingsPanel />
            <TicketFeed />
          </div>
          <div className="lg:col-span-1">
            <DemoControls />
          </div>
          <div className="lg:col-span-1">
            <IncidentTimeline />
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
