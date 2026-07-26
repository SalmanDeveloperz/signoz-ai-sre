import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { controlPlane } from '@/lib/api'
import type { Settings, SettingKey } from '@/lib/types'

export const SETTINGS_QUERY_KEY = ['settings'] as const

/** Polls control-plane every 2s, per FR-UI-01: settings should refresh
 * automatically without a page reload, since the agent changes them
 * asynchronously in the background. */
export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: controlPlane.getSettings,
    refetchInterval: 2000,
  })
}

export function useUpdateSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: SettingKey; value: Settings[SettingKey] }) =>
      controlPlane.updateSetting(key, value),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, data)
      toast.success(`Setting updated`, {
        description: `${variables.key} is now ${JSON.stringify(variables.value)}`,
      })
    },
    onError: (error: Error) => {
      toast.error('Could not update setting', { description: error.message })
    },
  })
}
