export interface Settings {
  use_backup_data: boolean
  active_model: string
  retry_enabled: boolean
}

export type SettingKey = keyof Settings

export interface Incident {
  id: number
  started_at: string
  resolved_at: string | null
  detected_via: string
  diagnosis: string
  action_taken: string
  safety_check_result: 'allowed' | 'blocked'
  cost_before: number | null
  cost_after: number | null
}

export interface TicketResponse {
  ticket_id: number
  customer?: { id: string; name: string }
  model: string
  estimated_cost_usd: number
  db_broken: boolean
  error?: string
}

/** Which tier handled an incident, inferred client-side since the backend
 * doesn't tag this yet (see README "What's done, what's left"). Tier 1's
 * two known failures always produce one of these two exact diagnoses. */
export function inferTier(incident: Incident): 'tier-1' | 'tier-2' {
  const isKnownTier1 =
    incident.diagnosis === 'customer-db unreachable, error rate crossed threshold' ||
    incident.diagnosis === 'per-ticket cost crossed threshold'
  return isKnownTier1 ? 'tier-1' : 'tier-2'
}
