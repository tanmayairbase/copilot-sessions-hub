/// <reference types="vite/client" />

declare global {
  interface Window {
    copilotSessions: import('@shared/types').RendererApi
  }
}

export {}
