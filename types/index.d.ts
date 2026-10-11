export type Bucket = [input: number, output: number, cacheRead: number, calls: number]

export type SessionRow = {
  id: string
  title: string
  project: string
  cwd: string
  first: number
  last: number
  byWindow: Record<string, Bucket>
  calls: [ts: number, input: number, output: number][]
}

export type WindowReport = {
  now: number
  windows: [start: number, end: number][]
  sessions: SessionRow[]
  percentUsed: number | null
  resetsAt: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'token-window': {
      report: WindowReport | null
      scope: string
      range: string
      showAll: boolean
    }
  }
}
