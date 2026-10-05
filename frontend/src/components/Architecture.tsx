export default function Architecture() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 flex flex-col items-center gap-0">

      {/* Title */}
      <div className="text-center mb-10">
        <h2 className="text-xl font-semibold text-gray-900 tracking-tight">How the Agent Solves a Crossword</h2>
        <p className="text-sm text-gray-400 mt-1">3 phases, fully automated</p>
      </div>

      {/* Phase 1 */}
      <Phase number={1} color="indigo" title="Generate Candidates">
        <p className="text-sm text-gray-500 leading-relaxed">
          Send every clue to the LLM in parallel. Each returns
          <span className="font-semibold text-indigo-600"> 20 ranked guesses</span>.
        </p>
        <div className="flex gap-1.5 mt-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex-1 h-7 bg-indigo-100 border border-indigo-200 rounded flex items-center justify-center">
              <span className="text-[10px] font-mono text-indigo-500">{i < 5 ? `Clue ${i + 1}` : '...'}</span>
            </div>
          ))}
        </div>
      </Phase>

      <Arrow />

      {/* Phase 2 */}
      <Phase number={2} color="amber" title="Fill Grid (MRV)">
        <p className="text-sm text-gray-500 leading-relaxed">
          Always fill the <span className="font-semibold text-amber-600">most constrained clue</span> first.
          Pick the best candidate that fits all crossing letters.
        </p>
        <div className="flex items-center gap-2 mt-3">
          {[
            { id: '14A', pct: 80 },
            { id: '7D', pct: 60 },
            { id: '22A', pct: 40 },
            { id: '3D', pct: 20 },
          ].map((c, i) => (
            <div key={c.id} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full" style={{ width: `${c.pct}%` }} />
              </div>
              <span className="text-[10px] font-mono text-gray-400">{c.id}</span>
              {i === 0 && <span className="text-[9px] font-semibold text-amber-500">pick first</span>}
            </div>
          ))}
        </div>
      </Phase>

      <Arrow />

      {/* Phase 3 */}
      <Phase number={3} color="emerald" title="Repair Conflicts">
        <p className="text-sm text-gray-500 leading-relaxed">
          Find words that <span className="font-semibold text-red-500">clash</span> at crossings.
          Re-ask the LLM with the known letters as constraints.
          Repeat until the grid <span className="font-semibold text-emerald-600">converges</span>.
        </p>
        <div className="flex items-center justify-center gap-3 mt-3 text-xs">
          <span className="px-2.5 py-1 bg-red-50 border border-red-200 text-red-500 rounded font-medium">S T A R <span className="text-red-400 line-through">K</span></span>
          <svg width="20" height="12" viewBox="0 0 20 12" className="text-gray-300 shrink-0"><path d="M0 6h14m0 0l-4-4m4 4l-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
          <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-600 rounded font-medium">S T A R E</span>
        </div>
      </Phase>

      <Arrow />

      {/* Output */}
      <div className="w-full bg-gray-900 text-white rounded-lg px-6 py-5 text-center shadow-lg">
        <div className="text-2xl font-bold tracking-tight">94.2% accuracy</div>
        <div className="text-sm text-gray-400 mt-1">Best model · Kimi K3 · 19 puzzles</div>
      </div>

      {/* Optional modules - compact */}
      <div className="flex gap-3 mt-10 w-full">
        <div className="flex-1 border border-gray-200 rounded-lg px-4 py-3 bg-white shadow-sm">
          <div className="text-xs font-semibold text-gray-900">Auto-Check</div>
          <p className="text-[11px] text-gray-400 mt-0.5">Verify each word against the solution. Wrong answers get rejected and retried.</p>
        </div>
        <div className="flex-1 border border-gray-200 rounded-lg px-4 py-3 bg-white shadow-sm">
          <div className="text-xs font-semibold text-gray-900">Web Search</div>
          <p className="text-[11px] text-gray-400 mt-0.5">If the LLM has no answer, search crossword sites for matching words.</p>
        </div>
        <div className="flex-1 border border-gray-200 rounded-lg px-4 py-3 bg-white shadow-sm">
          <div className="text-xs font-semibold text-gray-900">6 Models</div>
          <p className="text-[11px] text-gray-400 mt-0.5">Benchmarked on Nebius Token Factory. Kimi K3, GLM 5.3, MiniMax, and more.</p>
        </div>
      </div>
    </div>
  )
}


function Phase({ number, color, title, children }: {
  number: number
  color: 'indigo' | 'amber' | 'emerald'
  title: string
  children: React.ReactNode
}) {
  const styles = {
    indigo:  { ring: 'ring-indigo-100', num: 'bg-indigo-600', border: 'border-indigo-100' },
    amber:   { ring: 'ring-amber-100',  num: 'bg-amber-500',  border: 'border-amber-100' },
    emerald: { ring: 'ring-emerald-100', num: 'bg-emerald-600', border: 'border-emerald-100' },
  }
  const s = styles[color]

  return (
    <div className={`w-full bg-white border ${s.border} rounded-lg px-6 py-5 shadow-sm ring-1 ${s.ring}`}>
      <div className="flex items-center gap-3 mb-2">
        <span className={`${s.num} text-white w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0`}>
          {number}
        </span>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function Arrow() {
  return (
    <div className="flex flex-col items-center py-1.5">
      <div className="w-px h-4 bg-gray-300" />
      <svg width="10" height="6" viewBox="0 0 10 6" className="text-gray-300">
        <path d="M5 6L0 0h10z" fill="currentColor" />
      </svg>
    </div>
  )
}
