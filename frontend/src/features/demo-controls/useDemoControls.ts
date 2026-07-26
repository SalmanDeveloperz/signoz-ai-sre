import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { worker, watcher } from '@/lib/api'
import { ticketFeedStore } from '@/lib/ticketFeedStore'
import { SETTINGS_QUERY_KEY } from '@/features/settings/useSettings'

function useSimpleAction(fn: () => Promise<string>, successMessage: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(successMessage)
      // The settings panel polls every 2s anyway, but refetch immediately
      // so a click feels instant instead of waiting out the interval.
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY })
    },
    onError: (error: Error) => toast.error('Action failed', { description: error.message }),
  })
}

export function useBreakDb() {
  return useSimpleAction(worker.breakDb, 'DB marked broken. Send tickets to see it fail.')
}
export function useFixDb() {
  return useSimpleAction(worker.fixDb, 'DB fixed.')
}
export function useSpikeCost() {
  return useSimpleAction(worker.spikeCost, 'Cost spike turned on. Send tickets to see cost rise.')
}
export function useFixCost() {
  return useSimpleAction(worker.fixCost, 'Cost spike turned off.')
}

export function useSendTicket() {
  return useMutation({
    mutationFn: () => worker.sendTicket(),
    onSuccess: (response) => {
      ticketFeedStore.push({ id: crypto.randomUUID(), at: Date.now(), response })
      if (response.db_broken) {
        toast.warning(`Ticket #${response.ticket_id} failed: DB unreachable`)
      } else if (response.estimated_cost_usd >= 0.5) {
        toast.warning(`Ticket #${response.ticket_id} cost $${response.estimated_cost_usd.toFixed(2)}`)
      } else {
        toast.success(`Ticket #${response.ticket_id} handled ($${response.estimated_cost_usd.toFixed(2)})`)
      }
    },
    onError: (error: Error) => {
      ticketFeedStore.push({ id: crypto.randomUUID(), at: Date.now(), error: error.message })
      toast.error('Ticket failed', { description: error.message })
    },
  })
}

export function useTriggerUnrecognizedAlert() {
  return useMutation({
    mutationFn: () => watcher.triggerAlert('high-latency-alert'),
    onSuccess: () =>
      toast.success('Unrecognized alert sent to watcher-service', {
        description: 'Check the incident timeline in a few seconds for Tier 2\'s diagnosis.',
      }),
    onError: (error: Error) => toast.error('Could not reach watcher-service', { description: error.message }),
  })
}
