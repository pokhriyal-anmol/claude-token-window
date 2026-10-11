import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SessionRow, WindowReport } from '../types'

const VERSION = '0.5.2'
const PANE = 'token-window'
const DASHBOARD = { id: PANE, title: 'Token usage' }
const report = atom({ plugin: 'token-window', key: 'report' } as const, null)
const scope = atom({ plugin: 'token-window', key: 'scope' } as const, 'overall')
const range = atom({ plugin: 'token-window', key: 'range' } as const, '5h')
const showAll = atom({ plugin: 'token-window', key: 'showAll' } as const, false)

type Row = { label: string; input: number; output: number }
type Chart =
  | { kind: 'list'; rows: Row[]; more: number }
  | { kind: 'bars'; rows: Row[]; edge: [string, string, string]; avg: number | null }
  | { kind: 'message'; text: string; sub: string }
type View = {
  hero: [string, string]
  split: number
  rows: [string, string][]
  caption: string
  chart: Chart
}

let busy = false
let cwd = ''

const fmt = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`
    : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(n))
const hhmm = (ms: number): string => new Date(ms).toTimeString().slice(0, 5)
const mmdd = (ms: number): string => new Date(ms).toISOString().slice(5, 10)
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const total = (r: Row): number => r.input + r.output
const sum = (rows: Row[]): Row =>
  rows.reduce((a, r) => ({ ...a, input: a.input + r.input, output: a.output + r.output }), { label: 'total', input: 0, output: 0 })

/** Drawing width from the pane's columns; the pane scales it down if the real slot is narrower. */
const widthFor = (columns: number): number => Math.round(Math.min(520, Math.max(260, columns * 5.8 - 20)))

function windowRow(s: SessionRow, w: number): Row {
  const b = s.byWindow[String(w)] ?? [0, 0, 0, 0]
  return { label: s.title, input: b[0], output: b[1] }
}

function callsIn(rep: WindowReport, sessions: SessionRow[], idx: number[]): number {
  return sessions.reduce((a, s) => a + idx.reduce((m, w) => m + (s.byWindow[String(w)]?.[3] ?? 0), 0), 0)
}

/** Everything the pane shows for one scope + range, as plain data. */
function viewOf(rep: WindowReport, sc: string, rg: string, all: boolean): View {
  const last = rep.windows.length - 1
  const sessions = sc === 'overall' ? rep.sessions : rep.sessions.filter(s => s.id === sc)
  const isWindows = rg !== '5h'
  const idx = isWindows ? Array.from({ length: rep.windows.length }, (_, i) => i).slice(-(rg === '10s' ? 10 : 5)) : [last]
  const per = idx.map(w => ({ w, ...sum(sessions.map(s => windowRow(s, w))) }))
  const t = sum(per)
  const calls = callsIn(rep, sessions, idx)
  const reset = rep.resetsAt ? hhmm(Date.parse(rep.resetsAt)) : '--:--'
  const used = rep.percentUsed !== null ? ` · ${rep.percentUsed}% of account limit used` : ''
  const winTot = total(sum(rep.sessions.map(s => windowRow(s, last))))
  const mine = total(sum(sessions.map(s => windowRow(s, last))))
  const share = rep.percentUsed !== null && winTot ? `${Math.round((rep.percentUsed * mine) / winTot)}% est.` : 'n/a'
  const rows: [string, string][] = isWindows
    ? [['Avg per window', fmt(total(t) / Math.max(1, idx.length))], ['API calls', String(calls)]]
    : sc === 'overall' ? [['API calls', String(calls)], ['Sessions', String(sessions.filter(s => total(windowRow(s, last)) > 0).length)]]
      : [['API calls', String(calls)], ['Share of 5h limit', share]]
  const caption = isWindows
    ? `${idx.length} recent windows · current resets ${reset}`
    : `Resets at ${reset}${used}`
  const base = { hero: [fmt(t.input), fmt(t.output)] as [string, string], split: total(t) ? t.input / total(t) : 0.5, rows, caption }
  if (total(t) === 0) return { ...base, chart: { kind: 'message', text: 'No tokens in this range.', sub: 'Try another session or range.' } }
  if (isWindows) {
    const bars = per.map(p => ({ label: mmdd(rep.windows[p.w]?.[0] ?? 0), input: p.input, output: p.output }))
    return { ...base, chart: { kind: 'bars', rows: bars, edge: [bars[0]?.label ?? '', '', bars[bars.length - 1]?.label ?? ''], avg: total(t) / bars.length } }
  }
  if (sc === 'overall') {
    const list = sessions.map(s => windowRow(s, last)).filter(r => total(r) > 0).sort((a, b) => total(b) - total(a))
    return { ...base, chart: { kind: 'list', rows: all ? list : list.slice(0, 8), more: all ? 0 : Math.max(0, list.length - 8) } }
  }
  const from = rep.windows[last]?.[0] ?? 0
  const cs = (sessions[0]?.calls ?? []).filter(c => c[0] >= from).slice(-12)
  const bars = cs.map(c => ({ label: hhmm(c[0]), input: c[1], output: c[2] }))
  const mid = bars[Math.floor(bars.length / 2)]?.label ?? ''
  return { ...base, chart: { kind: 'bars', rows: bars, edge: [bars[0]?.label ?? '', mid, bars[bars.length - 1]?.label ?? ''], avg: null } }
}

const STYLE = `<style>
svg{--ink:#171a1f;--sec:#46515d;--mut:#697481;--grid:#e1e5e9;--axis:#5e6873;--div:#d9dee3;--in:#2a78d6;--out:#eb6834}
@media (prefers-color-scheme:dark){svg{--ink:#f2f4f6;--sec:#c5cbd2;--mut:#9ba5af;--grid:#343b43;--axis:#aeb6bf;--div:#3a4149;--in:#3987e5;--out:#d95926}}
text{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:11px;font-weight:450;fill:var(--axis)}
.ti{font-size:20px;font-weight:650;fill:var(--ink);letter-spacing:-.02em}.sc{font-size:12px;fill:var(--sec)}
.st{font-size:9px;font-weight:650;fill:var(--mut);letter-spacing:.08em}
.hv{font-size:22px;font-weight:620;fill:var(--ink);font-variant-numeric:tabular-nums}.hl{font-weight:560;fill:var(--sec)}
.dl{font-size:12px;font-weight:500;fill:var(--sec)}.dv{font-size:12px;font-weight:620;fill:var(--ink);font-variant-numeric:tabular-nums}
.cap{font-size:12px;fill:var(--sec)}.mu{fill:var(--mut)}.lg{font-weight:500;fill:var(--sec)}.nm{font-size:12px;font-weight:520;fill:var(--ink)}
.em{font-size:13px;font-weight:620;fill:var(--sec)}
.g{stroke:var(--grid)}.d{stroke:var(--div)}.a{stroke:var(--mut);stroke-width:1.5;stroke-dasharray:5 5}
.i{fill:var(--in)}.o{fill:var(--out)}
</style>`

const svg = (w: number, h: number, inner: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${STYLE}${inner}</svg>`

function headerSvg(w: number, scopeText: string, status: string): string {
  return svg(w, 56, `<text class="ti" x="0" y="22">Token usage</text>
<text class="st" x="${w}" y="14" text-anchor="end">${esc(status)}</text>
<text class="sc" x="0" y="44">${esc(cut(scopeText, Math.floor(w / 6.4)))}</text>`)
}

/** A stacked input|output segment pair of total width `width`, 2px apart. */
function stack(x: number, y: number, h: number, width: number, r: Row, max: number): string {
  const wi = (r.input / max) * width
  const wo = (r.output / max) * width
  return `<rect class="i" x="${x}" y="${y}" width="${wi}" height="${h}" rx="2"/><rect class="o" x="${x + wi + 2}" y="${y}" width="${Math.max(0, wo - 2)}" height="${h}" rx="2"/>`
}

function listChart(w: number, rows: Row[], more: number): { s: string; h: number } {
  const max = Math.max(1, ...rows.map(total))
  const sum1 = rows.reduce((n, r) => n + total(r), 0) + 1
  const body = rows.map((r, i) => {
    const y = i * 44
    return `<g><title>${esc(r.label)}: ${fmt(r.input)} input, ${fmt(r.output)} output</title>
<text class="nm" x="0" y="${y + 14}">${esc(cut(r.label, Math.floor((w - 80) / 6.4)))}</text>
<text class="dv" x="${w}" y="${y + 14}" text-anchor="end">${fmt(total(r))} · ${Math.round((total(r) / sum1) * 100)}%</text>
${stack(0, y + 22, 8, w, r, max)}</g>`
  }).join('')
  const tail = more > 0 ? `<text class="mu" x="0" y="${rows.length * 44 + 14}">+${more} more</text>` : ''
  return { s: body + tail, h: rows.length * 44 + (more > 0 ? 24 : 0) }
}

function barsChart(w: number, ch: number, c: Extract<Chart, { kind: 'bars' }>): string {
  const n = Math.max(1, c.rows.length)
  const bottom = ch - 26
  const top = 14
  const max = Math.max(1, ...c.rows.map(total), c.avg ?? 0) * 1.1
  const slot = w / n
  const bw = Math.min(28, slot * 0.62)
  const grid = [0, 0.5, 1].map(f => `<line class="g" x1="0" x2="${w}" y1="${bottom - f * (bottom - top)}" y2="${bottom - f * (bottom - top)}"/>`).join('')
  const bars = c.rows.map((r, i) => {
    const x = i * slot + (slot - bw) / 2
    const hi = (r.input / max) * (bottom - top)
    const ho = (r.output / max) * (bottom - top)
    return `<g><title>${esc(r.label)}: ${fmt(r.input)} input, ${fmt(r.output)} output</title>
<rect class="i" x="${x}" y="${bottom - hi}" width="${bw}" height="${hi}" rx="2"/>
<rect class="o" x="${x}" y="${bottom - hi - ho - 2}" width="${bw}" height="${ho}" rx="2"/></g>`
  }).join('')
  const [a, m, z] = c.edge
  const labels = `<text x="0" y="${ch - 6}">${esc(a)}</text><text x="${w / 2}" y="${ch - 6}" text-anchor="middle">${esc(m)}</text><text x="${w}" y="${ch - 6}" text-anchor="end">${esc(z)}</text>`
  const ay = c.avg === null ? 0 : bottom - (c.avg / max) * (bottom - top)
  const avg = c.avg === null ? '' : `<line class="a" x1="0" x2="${w}" y1="${ay}" y2="${ay}"/><text x="0" y="${ay - 5}">Avg ${fmt(c.avg)}</text>`
  return grid + bars + labels + avg
}

function bodySvg(w: number, v: View, ch: number): string {
  const hw = (w - 16) / 2
  const split = Math.min(0.999, Math.max(0.001, v.split))
  const hero = `<text class="hl" x="0" y="28">Input tokens</text><text class="hv" x="0" y="54">${esc(v.hero[0])}</text>
<line class="d" x1="${hw + 8}" x2="${hw + 8}" y1="14" y2="60"/>
<text class="hl" x="${hw + 16}" y="28">Output tokens</text><text class="hv" x="${hw + 16}" y="54">${esc(v.hero[1])}</text>
<rect class="i" x="0" y="70" width="${w * split - 1}" height="6" rx="1"/><rect class="o" x="${w * split + 1}" y="70" width="${w * (1 - split) - 1}" height="6" rx="1"/>`
  const rows = v.rows.map(([l, val], i) =>
    `<text class="dl" x="0" y="${100 + i * 24}">${esc(l)}</text><text class="dv" x="${w}" y="${100 + i * 24}" text-anchor="end">${esc(val)}</text>`).join('')
  const dy = 100 + v.rows.length * 24 + 2
  const cap = `<line class="d" x1="0" x2="${w}" y1="${dy}" y2="${dy}"/><text class="cap" x="0" y="${dy + 26}">${esc(cut(v.caption, Math.floor(w / 6)))}</text>`
  const top = dy + 44
  const c = v.chart
  const drawn = c.kind === 'list' ? listChart(w, c.rows, c.more)
    : c.kind === 'bars' ? { s: barsChart(w, ch, c), h: ch }
      : { s: `<line class="g" x1="0" x2="${w}" y1="0" y2="0"/><text class="em" x="${w / 2}" y="${ch / 2 - 6}" text-anchor="middle">${esc(c.text)}</text><text class="mu" x="${w / 2}" y="${ch / 2 + 12}" text-anchor="middle">${esc(c.sub)}</text><line class="g" x1="0" x2="${w}" y1="${ch - 20}" y2="${ch - 20}"/>`, h: ch }
  const ly = top + drawn.h + 18
  const legend = `<rect class="i" x="0" y="${ly - 6}" width="14" height="6" rx="2"/><text class="lg" x="20" y="${ly}">Input</text>
<rect class="o" x="68" y="${ly - 6}" width="14" height="6" rx="2"/><text class="lg" x="88" y="${ly}">Output</text>
<text class="mu" x="0" y="${ly + 20}">cache reads not counted</text>`
  return svg(w, ly + 32, `<line class="d" x1="0" x2="${w}" y1="0.5" y2="0.5"/>${hero}${rows}${cap}<g transform="translate(0,${top})">${drawn.s}</g>${legend}`)
}

function textLines(v: View): string[] {
  const c = v.chart
  const head = [`Input ${v.hero[0]}  ·  Output ${v.hero[1]}`, ...v.rows.map(([l, x]) => `${l}: ${x}`), v.caption]
  if (c.kind === 'message') return [...head, c.text]
  const rows = c.rows
  const max = Math.max(1, ...rows.map(total))
  return [...head, ...rows.map(r => `${cut(r.label, 22).padEnd(22)} ${'█'.repeat(Math.max(1, Math.round((r.input / max) * 26)))}${'▒'.repeat(Math.round((r.output / max) * 26))} ${fmt(total(r))}`)]
}

async function writeSessionFiles($: EngineInterface, rep: WindowReport): Promise<void> {
  if (!cwd) return
  const dir = `${cwd}/.claude/token-usage`
  const last = String(rep.windows.length - 1)
  await $.fs.write(`${dir}/.gitignore`, '*\n') // self-ignoring: no project file is touched
  for (const s of rep.sessions.filter(x => x.byWindow[last])) {
    const [input, output, cacheRead, calls] = s.byWindow[last] ?? [0, 0, 0, 0]
    const row = { id: s.id, title: s.title, project: s.project, input, output, cacheRead, calls, lastActive: s.last }
    await $.fs.write(`${dir}/${s.id}.json`, JSON.stringify(row, null, 2) + '\n')
  }
}

// shortcut: rescans 14 days of transcripts on each refresh, add an mtime cache if it gets slow
async function refresh($: EngineInterface): Promise<void> {
  if (busy) return
  busy = true
  try {
    const { rateLimits } = await $.session.usage()
    const win = rateLimits.find(r => r.kind === 'five_hour')
    const run = await $.process.run(['python3', `${$.plugin.root}/hooks/scan.py`], { timeoutMs: 60_000 })
    if (run.exitCode !== 0) {
      $.ui.log(`token-window: scan failed: ${run.stderr.slice(0, 300)}`, { to: 'debug' })
      return
    }
    const data = JSON.parse(run.stdout) as Omit<WindowReport, 'percentUsed' | 'resetsAt'>
    const rep: WindowReport = { ...data, percentUsed: win?.percentUsed ?? null, resetsAt: win?.resetsAt ?? null }
    await update($, report, () => rep)
    await writeSessionFiles($, rep)
    const v = viewOf(rep, 'overall', '5h', false)
    $.ui.status(`5h: ${v.hero[0]} in / ${v.hero[1]} out${win ? ` (${win.percentUsed}%)` : ''}`)
  } catch (err) {
    $.ui.log(`token-window: ${String(err)}`, { to: 'debug' })
  } finally {
    busy = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tokens', description: 'Open the token usage dashboard' })
    cwd = e.cwd
    void refresh($)

    return next(e)
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open(DASHBOARD)
    void refresh($)

    return { text: 'Token dashboard opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void refresh($)

    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rep = await read($, report)
    if (e.props.hasSurvey || !rep) return next(e)

    const { Box, Button } = $.ui.resolve(e)
    const v = viewOf(rep, 'overall', '5h', false)

    return (
      <Box>
        <Button
          key="open"
          label={`5h tokens: ${v.hero[0]} in / ${v.hero[1]} out${rep.percentUsed !== null ? ` (${rep.percentUsed}%)` : ''}  [open dashboard]`}
          onPress={() => $.ui.open(DASHBOARD)}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Select } = ui
    const Svg = 'Svg' in ui ? ui.Svg : null
    const rep = await read($, report)
    const sc = await read($, scope)
    const rg = await read($, range)
    const all = await read($, showAll)
    const w = widthFor(e.viewport?.columns ?? 54)
    const ch = Math.round(Math.min(220, Math.max(160, ((e.viewport?.rows ?? 40) * 18 - 420))))

    const picked = rep?.sessions.some(s => s.id === sc) ? sc : 'overall'
    const cur = rep?.sessions.find(s => s.id === picked)
    const scopeText = cur ? cur.title : 'all sessions'
    const status = rep ? 'LOCAL' : 'SCANNING'
    const lastIdx = (rep?.windows.length ?? 1) - 1
    const view: View = rep
      ? viewOf(rep, picked, rg, all)
      : { hero: ['—', '—'], split: 0.5, rows: [['API calls', '—']], caption: 'Looking for usage in the current 5-hour window',
        chart: { kind: 'message', text: 'Scanning transcripts...', sub: 'Reading local usage records' } }
    const options = [
      { value: 'overall', label: 'all sessions' },
      ...(rep?.sessions.filter(s => s.byWindow[String(lastIdx)]).slice(0, 25).map(s => ({ value: s.id, label: cut(s.title, 48) })) ?? []),
    ]
    const more = rep && picked === 'overall' && rg === '5h' && (view.chart.kind === 'list') && (view.chart.more > 0 || all)

    return (
      <Box flexDirection="column">
        <Box>
          {Svg !== null && <Svg key="head" alt={`Token usage, ${scopeText}`} source={headerSvg(w - 96, scopeText, `${status} · v${VERSION}`)} />}
          {Svg === null && <Text bold>Token usage · {scopeText}</Text>}
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
        </Box>
        <Select key="scope" label="Show" options={options} value={picked} onSelect={v => update($, scope, () => v)} />
        <Select key="range" label="Range" value={rg}
          options={[
            { value: '5h', label: 'Last 5 hours' },
            { value: '5s', label: 'Last 5 sessions (windows)' },
            { value: '10s', label: 'Last 10 sessions (windows)' },
          ]}
          onSelect={v => update($, range, () => v)} />
        {Svg !== null && (
          <Svg key="body" alt={`Input ${view.hero[0]}, output ${view.hero[1]}. ${view.caption}`} source={bodySvg(w, view, ch)} />
        )}
        {Svg === null && textLines(view).map(l => <Text key={l}>{l}</Text>)}
        {more && <Button key="all" label={all ? 'Show top 8' : 'Show all sessions'} onPress={() => update($, showAll, x => !x)} />}
      </Box>
    )
  })
}
