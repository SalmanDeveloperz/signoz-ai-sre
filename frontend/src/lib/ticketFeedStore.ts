import { useSyncExternalStore } from 'react'
import type { TicketResponse } from './types'

/**
 * worker-service keeps no history of past tickets (see README, ticket IDs
 * are an in-memory counter), so the "live ticket feed" panel can only ever
 * show what this browser tab itself has sent. A tiny pub-sub store, capped
 * at 20 entries, newest first. No extra state library needed for this.
 */
export interface FeedEntry {
  id: string
  at: number
  response?: TicketResponse
  error?: string
}

let entries: FeedEntry[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export const ticketFeedStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot() {
    return entries
  },
  push(entry: FeedEntry) {
    entries = [entry, ...entries].slice(0, 20)
    emit()
  },
}

export function useTicketFeed() {
  return useSyncExternalStore(ticketFeedStore.subscribe, ticketFeedStore.getSnapshot)
}
