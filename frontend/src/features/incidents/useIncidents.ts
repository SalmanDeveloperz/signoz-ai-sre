import { useQuery } from '@tanstack/react-query'
import { controlPlane } from '@/lib/api'

/** Polls the audit log every 2s, per FR-UI-02: the incident timeline should
 * refresh automatically, most recent first (control-plane already orders
 * by started_at DESC). */
export function useIncidents() {
  return useQuery({
    queryKey: ['incidents'],
    queryFn: controlPlane.getIncidents,
    refetchInterval: 2000,
  })
}
