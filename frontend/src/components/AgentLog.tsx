import type { SolveStep } from '../types'

interface Props {
  steps: SolveStep[]
}

const ACTION_BADGE: Record<string, { label: string; classes: string }> = {
  candidates: { label: 'CANDIDATES', classes: 'bg-blue-100 text-blue-700' },
  fill:       { label: 'FILL',       classes: 'bg-green-100 text-green-700' },
  skip:       { label: 'SKIP',       classes: 'bg-gray-100 text-gray-500' },
  conflict:   { label: 'CONFLICT',   classes: 'bg-red-100 text-red-700' },
  repair:     { label: 'REPAIR',     classes: 'bg-orange-100 text-orange-700' },
  converged:  { label: 'CONVERGED',  classes: 'bg-emerald-100 text-emerald-700' },
  done:       { label: 'DONE',       classes: 'bg-purple-100 text-purple-700' },
}

const PHASE_COLOR = ['', 'text-blue-500', 'text-green-500', 'text-orange-500']

export default function AgentLog({ steps }: Props) {
  if (!steps.length) {
    return (
      <div className="text-gray-400 text-sm p-4">
        Agent decisions will appear here once solving starts.
      </div>
    )
  }

  return (
    <div className="flex flex-row gap-2 h-full">
      {[...steps].reverse().map((step, i) => {
        const badge = ACTION_BADGE[step.action] ?? { label: step.action.toUpperCase(), classes: 'bg-gray-200 text-gray-600' }
        return (
          <div
            key={i}
            className="bg-white border border-gray-200 rounded-lg p-3 text-sm shadow-sm w-48 shrink-0 overflow-hidden"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-bold ${PHASE_COLOR[step.phase] ?? 'text-gray-500'}`}>
                P{step.phase}
              </span>
              {step.clue_id && (
                <span className="font-semibold text-gray-700">{step.clue_id}</span>
              )}
              {step.iteration > 0 && (
                <span className="text-gray-400 text-xs">iter {step.iteration}</span>
              )}
              <span className={`ml-auto px-2 py-0.5 rounded text-xs font-semibold ${badge.classes}`}>
                {badge.label}
              </span>
            </div>

            {step.clue_text && (
              <p className="text-gray-600 italic mb-1 text-xs truncate">"{step.clue_text}"</p>
            )}

            {step.pattern && (
              <p className="text-gray-500 text-xs mb-1">Pattern: <code className="font-mono bg-gray-100 px-1 rounded">{step.pattern}</code></p>
            )}

            {step.candidates.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {step.candidates.map((c, j) => (
                  <span
                    key={j}
                    className={`px-1.5 py-0.5 rounded text-xs font-mono ${
                      c === step.chosen
                        ? 'bg-green-500 text-white font-bold'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}

            {step.note && (
              <p className="text-gray-400 text-xs mt-1">{step.note}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
