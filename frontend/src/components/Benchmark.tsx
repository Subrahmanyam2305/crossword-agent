import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ScatterChart, Scatter, ZAxis,
} from 'recharts'
import { useBenchmark } from '../hooks/useBenchmark'
import type { BenchmarkModelSummary, SavedRun } from '../types'

// ── colour palette (one per model slot) ──────────────────────────────────────
const MODEL_COLORS: Record<string, string> = {
  'kimi-k3':         '#6366f1',
  'deepseek-v4-pro': '#f59e0b',
  'gpt-oss-120b':    '#10b981',
  'qwen3-5-397b':    '#3b82f6',
  'nemotron-super':  '#ec4899',
  'glm-5-3':         '#8b5cf6',
}
const colorFor = (key: string) => MODEL_COLORS[key] ?? '#94a3b8'

// ── heat-scale: 0% = red, 50% = amber, 100% = green ──────────────────────────
function heatColor(pct: number): string {
  if (pct >= 70) return 'bg-green-500 text-white'
  if (pct >= 50) return 'bg-green-300 text-green-900'
  if (pct >= 30) return 'bg-yellow-200 text-yellow-900'
  if (pct >= 10) return 'bg-orange-300 text-orange-900'
  return 'bg-red-300 text-red-900'
}

// ── simple quartile helper ────────────────────────────────────────────────────
function quartiles(vals: number[]) {
  if (!vals.length) return null
  const sorted = [...vals].sort((a, b) => a - b)
  const q = (p: number) => {
    const idx = p * (sorted.length - 1)
    const lo = Math.floor(idx), hi = Math.ceil(idx)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
  }
  return { min: sorted[0], q1: q(0.25), median: q(0.5), q3: q(0.75), max: sorted[sorted.length - 1] }
}

// ── BoxPlot (custom SVG) ──────────────────────────────────────────────────────
function BoxPlot({ summaries, results, puzzleIds }: {
  summaries: BenchmarkModelSummary[]
  results: Record<string, Record<string, { word_pct?: number; status: string }>>
  puzzleIds: string[]
}) {
  const W = 560, H = 220, PAD = { l: 100, r: 20, t: 20, b: 10 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  const entries = summaries.map((s) => {
    const vals = puzzleIds
      .map((p) => results[s.model]?.[p])
      .filter((c) => c?.status === 'done' && c.word_pct != null)
      .map((c) => c!.word_pct!)
    return { label: s.label, color: colorFor(s.model), stats: quartiles(vals) }
  }).filter((e) => e.stats)

  if (!entries.length) return null

  const slotH = innerH / entries.length
  const xScale = (v: number) => PAD.l + (v / 100) * innerW
  const gridLines = [0, 25, 50, 75, 100]

  return (
    <svg width={W} height={H} className="w-full" viewBox={`0 0 ${W} ${H}`}>
      {/* grid */}
      {gridLines.map((v) => (
        <line key={v} x1={xScale(v)} y1={PAD.t} x2={xScale(v)} y2={PAD.t + innerH}
          stroke="#e5e7eb" strokeWidth={1} />
      ))}
      {gridLines.map((v) => (
        <text key={v} x={xScale(v)} y={PAD.t + innerH + 14} textAnchor="middle"
          fontSize={10} fill="#9ca3af">{v}%</text>
      ))}
      {entries.map((e, i) => {
        const s = e.stats!
        const cy = PAD.t + i * slotH + slotH / 2
        const boxH = Math.max(slotH * 0.4, 12)
        return (
          <g key={e.label}>
            <text x={PAD.l - 8} y={cy + 4} textAnchor="end" fontSize={11} fill="#374151">{e.label}</text>
            {/* whiskers */}
            <line x1={xScale(s.min)} y1={cy} x2={xScale(s.q1)} y2={cy} stroke={e.color} strokeWidth={1.5} strokeDasharray="3 2" />
            <line x1={xScale(s.q3)} y1={cy} x2={xScale(s.max)} y2={cy} stroke={e.color} strokeWidth={1.5} strokeDasharray="3 2" />
            {/* end caps */}
            <line x1={xScale(s.min)} y1={cy - boxH / 3} x2={xScale(s.min)} y2={cy + boxH / 3} stroke={e.color} strokeWidth={1.5} />
            <line x1={xScale(s.max)} y1={cy - boxH / 3} x2={xScale(s.max)} y2={cy + boxH / 3} stroke={e.color} strokeWidth={1.5} />
            {/* IQR box */}
            <rect x={xScale(s.q1)} y={cy - boxH / 2} width={xScale(s.q3) - xScale(s.q1)} height={boxH}
              fill={e.color} fillOpacity={0.2} stroke={e.color} strokeWidth={1.5} rx={2} />
            {/* median */}
            <line x1={xScale(s.median)} y1={cy - boxH / 2} x2={xScale(s.median)} y2={cy + boxH / 2}
              stroke={e.color} strokeWidth={2.5} />
          </g>
        )
      })}
    </svg>
  )
}

// ── Chart card wrapper ────────────────────────────────────────────────────────
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
      {children}
    </div>
  )
}

// ── Main Benchmark component ──────────────────────────────────────────────────
export default function Benchmark() {
  const {
    status, results, puzzleIds, modelKeys, summaries,
    availableModels, savedRuns, activeRunId,
    error, start, stop, loadRun,
  } = useBenchmark()

  const [selectedModels, setSelectedModels] = useState<string[]>(['kimi-k3', 'deepseek-v4-pro'])
  const [oracle, setOracle] = useState(false)
  const [webSearch, setWebSearch] = useState(false)

  const isRunning = status === 'running'
  const hasResults = summaries.length > 0 && summaries.some((s) => s.puzzles_done > 0)

  // ── grouped bar data (agent vs naive) ──────────────────────────────────────
  const agentVsNaiveData = summaries.map((s) => ({
    name: s.label,
    'Agent Word %': s.avg_word_pct,
    'Naive Word %': s.avg_naive_pct,
  }))

  // ── letter accuracy bar ────────────────────────────────────────────────────
  const letterData = summaries.map((s) => ({
    name: s.label,
    'Word %': s.avg_word_pct,
    'Letter %': s.avg_letter_pct,
  }))

  // ── stacked clue outcomes ──────────────────────────────────────────────────
  const outcomeData = summaries.map((s) => ({
    name: s.label,
    Correct: Math.round(s.avg_word_pct),
    Wrong: Math.round(s.avg_wrong_pct),
    Blank: Math.round(s.avg_blank_pct),
  }))

  // ── scatter data ──────────────────────────────────────────────────────────
  const scatterData = summaries.map((s) => ({
    x: s.avg_word_pct,
    y: s.avg_letter_pct,
    name: s.label,
    model: s.model,
  }))

  const totalJobs = modelKeys.length * (puzzleIds.length || 1)
  const doneJobs = modelKeys.reduce((acc, m) =>
    acc + Object.values(results[m] ?? {}).filter((c) => c.status === 'done' || c.status === 'error').length, 0)
  const progressPct = totalJobs > 0 ? Math.round((doneJobs / totalJobs) * 100) : 0

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-4 flex flex-col gap-6">

      {/* ── Controls ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-wrap gap-6 items-end">
        {/* Model selection */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Models</span>
          <div className="flex flex-wrap gap-2">
            {availableModels.map((m) => {
              const checked = selectedModels.includes(m.id)
              return (
                <label key={m.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs cursor-pointer select-none transition-colors ${
                  checked
                    ? 'border-transparent text-white'
                    : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'
                } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                  style={checked ? { backgroundColor: colorFor(m.id), borderColor: colorFor(m.id) } : {}}>
                  <input type="checkbox" className="hidden" checked={checked} disabled={isRunning}
                    onChange={(e) => setSelectedModels(prev =>
                      e.target.checked ? [...prev, m.id] : prev.filter((x) => x !== m.id)
                    )} />
                  {m.label}
                </label>
              )
            })}
          </div>
        </div>

        {/* Options */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Options</span>
          <div className="flex gap-2">
            {([['oracle', oracle, setOracle, 'Auto-check', 'amber'], ['webSearch', webSearch, setWebSearch, 'Web search', 'emerald']] as const).map(
              ([, val, setter, label, color]) => (
                <label key={label} className={`flex items-center gap-2 border rounded-md px-3 py-2 text-sm cursor-pointer select-none transition-colors ${
                  val ? `bg-${color}-50 border-${color}-400 text-${color}-700` : 'bg-white border-gray-300 text-gray-500'
                } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <input type="checkbox" checked={val} disabled={isRunning}
                    onChange={(e) => (setter as (v: boolean) => void)(e.target.checked)} />
                  {label}
                </label>
              )
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 ml-auto items-end">
          {/* Saved runs */}
          {savedRuns.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">History</span>
              <select
                className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                value={activeRunId ?? ''}
                onChange={(e) => {
                  const run = savedRuns.find((r) => r.id === e.target.value)
                  if (run) loadRun(run)
                }}>
                {savedRuns.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} · {r.models.length} models{r.oracle ? ' · oracle' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isRunning ? (
            <button onClick={stop}
              className="px-5 py-2 bg-red-500 text-white rounded-md font-semibold text-sm shadow hover:bg-red-600">
              Stop
            </button>
          ) : (
            <button onClick={() => start(selectedModels, oracle, webSearch)}
              disabled={selectedModels.length === 0}
              className="px-5 py-2 bg-indigo-600 text-white rounded-md font-semibold text-sm shadow hover:bg-indigo-700 disabled:opacity-40">
              Run Benchmark
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* ── Progress bar ── */}
      {isRunning && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Running {modelKeys.length} models × {puzzleIds.length} puzzles…</span>
            <span className="font-medium">{doneJobs} / {totalJobs} done ({progressPct}%)</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!hasResults && !isRunning && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-lg font-medium text-gray-500">No benchmark results yet</p>
          <p className="text-sm mt-1">Select models above and click Run Benchmark</p>
        </div>
      )}

      {/* ── Charts ── */}
      {hasResults && (
        <>
          {/* Row 1: agent vs naive + outcomes */}
          <div className="grid grid-cols-2 gap-5">
            <ChartCard title="Agent vs Naive LLM — Avg Word Accuracy (%)">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={agentVsNaiveData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Legend />
                  <Bar dataKey="Agent Word %" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Naive Word %" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Clue Outcomes per Model (avg %)">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={outcomeData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Legend />
                  <Bar dataKey="Correct" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Wrong" stackId="a" fill="#f59e0b" />
                  <Bar dataKey="Blank" stackId="a" fill="#f87171" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Row 2: letter accuracy + scatter */}
          <div className="grid grid-cols-2 gap-5">
            <ChartCard title="Word % vs Letter % Accuracy">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={letterData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Legend />
                  <Bar dataKey="Word %" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Letter %" fill="#a5b4fc" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Word % vs Letter % — Scatter (avg per model)">
              <ResponsiveContainer width="100%" height={240}>
                <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="x" type="number" domain={[0, 100]} name="Word %" unit="%" tick={{ fontSize: 11 }} label={{ value: 'Word %', position: 'insideBottom', offset: -4, fontSize: 11 }} />
                  <YAxis dataKey="y" type="number" domain={[0, 100]} name="Letter %" unit="%" tick={{ fontSize: 11 }} label={{ value: 'Letter %', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                  <ZAxis range={[80, 80]} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }}
                    content={({ payload }) => {
                      if (!payload?.length) return null
                      const d = payload[0].payload
                      return (
                        <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs shadow">
                          <div className="font-semibold mb-1">{d.name}</div>
                          <div>Word: {d.x}%</div>
                          <div>Letter: {d.y}%</div>
                        </div>
                      )
                    }}
                  />
                  {scatterData.map((d) => (
                    <Scatter key={d.model} name={d.name} data={[d]}
                      fill={colorFor(d.model)} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Row 3: box plot + summary table */}
          <div className="grid grid-cols-2 gap-5">
            <ChartCard title="Word % Distribution Across Puzzles (per model)">
              <BoxPlot summaries={summaries} results={results as any} puzzleIds={puzzleIds} />
            </ChartCard>

            <ChartCard title="Summary">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 pr-3 font-semibold text-gray-500">Model</th>
                      <th className="text-right py-2 px-2 font-semibold text-gray-500">Agent %</th>
                      <th className="text-right py-2 px-2 font-semibold text-gray-500">Naive %</th>
                      <th className="text-right py-2 px-2 font-semibold text-gray-500">Letter %</th>
                      <th className="text-right py-2 px-2 font-semibold text-gray-500">Blank %</th>
                      <th className="text-right py-2 px-2 font-semibold text-gray-500">Puzzles</th>
                      <th className="text-right py-2 font-semibold text-gray-500">Avg time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...summaries].sort((a, b) => b.avg_word_pct - a.avg_word_pct).map((s) => (
                      <tr key={s.model} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: colorFor(s.model) }} />
                            {s.label}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 font-semibold text-indigo-600">{s.avg_word_pct}%</td>
                        <td className="text-right py-2 px-2 text-gray-500">{s.avg_naive_pct}%</td>
                        <td className="text-right py-2 px-2 text-gray-600">{s.avg_letter_pct}%</td>
                        <td className="text-right py-2 px-2 text-red-500">{s.avg_blank_pct}%</td>
                        <td className="text-right py-2 px-2 text-gray-500">
                          {s.puzzles_done}/{s.total_puzzles}
                        </td>
                        <td className="text-right py-2 text-gray-500">{s.avg_elapsed_s}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </div>

          {/* Row 4: heatmap */}
          <ChartCard title="Heatmap — Word Accuracy per Model × Puzzle">
            <div className="overflow-x-auto">
              <table className="text-xs border-separate border-spacing-0.5">
                <thead>
                  <tr>
                    <th className="text-left pr-3 pb-1 font-semibold text-gray-500 whitespace-nowrap">Puzzle</th>
                    {summaries.map((s) => (
                      <th key={s.model} className="pb-1 font-semibold text-gray-500 min-w-[90px] text-center">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {puzzleIds.map((puzzle) => (
                    <tr key={puzzle}>
                      <td className="pr-3 py-0.5 text-gray-500 whitespace-nowrap font-mono">{puzzle}</td>
                      {summaries.map((s) => {
                        const cell = results[s.model]?.[puzzle]
                        if (!cell) return <td key={s.model} className="rounded text-center py-1 px-2 bg-gray-50 text-gray-300">—</td>
                        if (cell.status === 'running') return (
                          <td key={s.model} className="rounded text-center py-1 px-2 bg-blue-50 text-blue-400 animate-pulse">…</td>
                        )
                        if (cell.status === 'error') return (
                          <td key={s.model} className="rounded text-center py-1 px-2 bg-red-50 text-red-400">err</td>
                        )
                        const pct = cell.word_pct ?? 0
                        return (
                          <td key={s.model}
                            title={`${s.label} · ${puzzle} · ${cell.words_correct}/${cell.total_words} words · ${pct}%`}
                            className={`rounded text-center py-1 px-2 font-medium cursor-default ${heatColor(pct)}`}>
                            {pct}%
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </>
      )}
    </div>
  )
}
