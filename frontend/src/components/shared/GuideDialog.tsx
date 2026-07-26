import { BookOpen, Zap, Sparkles, ArrowRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'

interface StepProps {
  n: number
  children: React.ReactNode
}

function Step({ n, children }: StepProps) {
  return (
    <li className="flex gap-3">
      <span className="border-primary/40 bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
        {n}
      </span>
      <div className="flex-1 pt-0.5 text-sm leading-relaxed">{children}</div>
    </li>
  )
}

/**
 * The in-app equivalent of README Section 1 + 2, so a presenter (or anyone
 * evaluating this project) never has to leave the browser to understand
 * what they're looking at or how to drive the demo.
 */
export function GuideDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="gap-1.5">
          <BookOpen className="size-4" />
          Guide
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="text-primary size-5" />
            How this demo works
          </DialogTitle>
          <DialogDescription>
            A self-healing infrastructure system, observed end to end through SigNoz.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="flow" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="flow">How it works</TabsTrigger>
            <TabsTrigger value="try">Try it yourself</TabsTrigger>
          </TabsList>

          <TabsContent value="flow">
            <ScrollArea className="h-[420px] pr-4">
              <div className="flex flex-col gap-5 py-2">
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                    <ArrowRight className="text-muted-foreground size-3.5" />A normal request
                  </p>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Sending a ticket hits <span className="font-mono">worker-service</span>, which reads
                    the 3 shared settings from <span className="font-mono">control-plane</span> and
                    responds accordingly. Every request is traced with OpenTelemetry and exported to
                    SigNoz.
                  </p>
                </div>

                <Separator />

                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                    <Zap className="text-muted-foreground size-3.5" />
                    Tier 1: a known failure, self-healing
                  </p>
                  <ol className="flex flex-col gap-2">
                    <Step n={1}>Break the DB or spike the cost with the demo buttons below.</Step>
                    <Step n={2}>
                      Sustained ticket traffic now fails or reports high cost. SigNoz's own alert rules
                      are continuously evaluating this telemetry.
                    </Step>
                    <Step n={3}>
                      Once the threshold crosses, SigNoz calls{' '}
                      <span className="font-mono">watcher-service</span>'s webhook on its own, no human
                      involved.
                    </Step>
                    <Step n={4}>
                      watcher-service recognizes the alert, checks a hardcoded safety rule, flips the
                      matching setting on control-plane, and logs an incident, always.
                    </Step>
                    <Step n={5}>
                      The very next ticket reads the updated setting. No restart, no deploy.
                    </Step>
                  </ol>
                </div>

                <Separator />

                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                    <Sparkles className="text-primary size-3.5" />
                    Tier 2: an alert nobody wrote a rule for
                  </p>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    When an alert's name matches neither known pattern, watcher-service hands it to an
                    LLM (Gemini by default) instead of giving up. The model investigates using SigNoz's
                    own Query API as its tools, exactly like a human on-call engineer would, then
                    proposes a diagnosis and, if it has real evidence, a fix restricted to the same 3
                    known settings. Its entire investigation, every tool call and every token used, is
                    itself traced in SigNoz.
                  </p>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="try">
            <ScrollArea className="h-[420px] pr-4">
              <ol className="flex flex-col gap-3 py-2">
                <Step n={1}>
                  Check the status strip in the header, all 3 services should show a green dot.
                </Step>
                <Step n={2}>
                  Click <span className="font-medium">Break DB</span>, then turn on{' '}
                  <span className="font-medium">Auto-send</span> for a minute or two. Watch{' '}
                  <span className="font-mono">use_backup_data</span> flip to true on its own in the
                  Settings panel, and a new row appear in the Incident timeline.
                </Step>
                <Step n={3}>
                  Click <span className="font-medium">Fix DB</span> to reset, then repeat with{' '}
                  <span className="font-medium">Spike cost</span> / <span className="font-medium">Fix cost</span>{' '}
                  to see <span className="font-mono">active_model</span> flip instead.
                </Step>
                <Step n={4}>
                  Click <span className="font-medium">Trigger unrecognized alert</span> to force Tier 2.
                  Within a few seconds a new incident appears with a model-generated diagnosis instead of
                  a hardcoded one.
                </Step>
                <Step n={5}>
                  Use the search box on the Incident timeline to filter by anything, e.g. try{' '}
                  <span className="font-mono">blocked</span> or <span className="font-mono">tier</span>.
                </Step>
                <Step n={6}>
                  Click <span className="font-medium">Open in SigNoz</span> on any incident to see the
                  real trace, including Tier 2's own reasoning as a span named{' '}
                  <span className="font-mono">investigate.tier2</span>.
                </Step>
              </ol>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
