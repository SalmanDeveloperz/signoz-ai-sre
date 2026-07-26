import { useQuery } from '@tanstack/react-query'
import { controlPlane, worker, watcher } from '@/lib/api'

export function useServiceStatus() {
  const controlPlaneUp = useQuery({
    queryKey: ['status', 'control-plane'],
    queryFn: controlPlane.ping,
    refetchInterval: 5000,
  })
  const workerUp = useQuery({
    queryKey: ['status', 'worker'],
    queryFn: worker.ping,
    refetchInterval: 5000,
  })
  const watcherUp = useQuery({
    queryKey: ['status', 'watcher'],
    queryFn: watcher.ping,
    refetchInterval: 5000,
  })

  return [
    { name: 'control-plane', port: 4001, up: controlPlaneUp.data, loading: controlPlaneUp.isLoading },
    { name: 'worker-service', port: 4000, up: workerUp.data, loading: workerUp.isLoading },
    { name: 'watcher-service', port: 4002, up: watcherUp.data, loading: watcherUp.isLoading },
  ]
}
