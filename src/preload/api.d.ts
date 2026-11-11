import type { TotemApi } from '../shared/ipc'

declare global {
  interface Window {
    totem: TotemApi
  }
}

export {}
