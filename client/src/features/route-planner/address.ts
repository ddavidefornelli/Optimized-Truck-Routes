import type { Coordinates } from './domain'

export interface AddressSuggestion {
  id: string
  label: string
  coordinates: Coordinates
}

export interface AddressSearch {
  search: (text: string, signal: AbortSignal) => Promise<AddressSuggestion[]>
}
