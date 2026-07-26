import type { Incident, Settings, SettingKey, TicketResponse } from './types'

/**
 * All 3 backend services are reached through Vite's dev-server proxy
 * (see vite.config.ts), so every request here is same-origin from the
 * browser's point of view and needs no CORS setup on the Express services.
 */
const CONTROL_PLANE = '/api/control-plane'
const WORKER = '/api/worker'
const WATCHER = '/api/watcher'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const body = isJson ? await res.json() : await res.text()
  if (!res.ok) {
    const message =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : typeof body === 'string'
          ? body
          : `request failed with ${res.status}`
    const err = new Error(message) as Error & { status?: number; body?: unknown }
    err.status = res.status
    err.body = body
    throw err
  }
  return body as T
}

/** Resolves true if the service responds at all (even a 404), false only
 * on an actual network failure. worker-service has no dedicated health
 * route, so "responds to anything" is the honest signal available. */
async function pingUp(url: string): Promise<boolean> {
  try {
    await fetch(url, { method: 'GET' })
    return true
  } catch {
    return false
  }
}

export const controlPlane = {
  getSettings: () => request<Settings>(`${CONTROL_PLANE}/settings`),
  updateSetting: (key: SettingKey, value: Settings[SettingKey]) =>
    request<Settings>(`${CONTROL_PLANE}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ key, value, updated_by: 'ui' }),
    }),
  getIncidents: () => request<Incident[]>(`${CONTROL_PLANE}/incidents`),
  ping: () => pingUp(`${CONTROL_PLANE}/settings`),
}

export const worker = {
  sendTicket: (customerId?: string) =>
    request<TicketResponse>(`${WORKER}/tickets`, {
      method: 'POST',
      body: JSON.stringify(customerId ? { customerId } : {}),
    }),
  breakDb: () => request<string>(`${WORKER}/debug/break-db`, { method: 'POST' }),
  fixDb: () => request<string>(`${WORKER}/debug/fix-db`, { method: 'POST' }),
  spikeCost: () => request<string>(`${WORKER}/debug/spike-cost`, { method: 'POST' }),
  fixCost: () => request<string>(`${WORKER}/debug/fix-cost`, { method: 'POST' }),
  ping: () => pingUp(`${WORKER}/tickets`),
}

export const watcher = {
  triggerAlert: (alertname: string) =>
    request<{ received: boolean }>(`${WATCHER}/alerts/webhook`, {
      method: 'POST',
      body: JSON.stringify({
        alerts: [{ labels: { alertname } }],
        commonLabels: { alertname },
      }),
    }),
  status: () => request<{ status: string }>(`${WATCHER}/watcher/status`),
  ping: async () => {
    try {
      await watcher.status()
      return true
    } catch {
      return false
    }
  },
}
