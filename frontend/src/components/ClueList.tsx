import { useEffect, useRef } from 'react'
import type { Clue, SolveStep } from '../types'

interface Props {
  clues: Clue[]
  steps: SolveStep[]
  selectedClueId: string | null
  onSelectClue: (id: string) => void
  grid: string[][]
}

function getFilledWord(clue: Clue, grid: string[][]): string {
  let word = ''
  for (let i = 0; i < clue.length; i++) {
    const r = clue.start[0] + (clue.direction === 'D' ? i : 0)
    const c = clue.start[1] + (clue.direction === 'A' ? i : 0)
    word += grid[r]?.[c] || '_'
  }
  return word
}

export default function ClueList({ clues, steps, selectedClueId, onSelectClue, grid }: Props) {
  const across = clues.filter((c) => c.direction === 'A').sort((a, b) => a.number - b.number)
  const down   = clues.filter((c) => c.direction === 'D').sort((a, b) => a.number - b.number)

  // Map clue_id → step for quick lookup
  const stepMap = new Map<string, SolveStep>()
  for (const s of steps) {
    if (s.clue_id) stepMap.set(s.clue_id, s)
  }

  const selectedClue = clues.find((c) => c.id === selectedClueId)
  const selectedStep = selectedClueId ? stepMap.get(selectedClueId) : null

  function ClueItem({ clue }: { clue: Clue }) {
    const step = stepMap.get(clue.id)
    const filled = grid.length > 0 ? getFilledWord(clue, grid) : ''
    const isSelected = clue.id === selectedClueId

    // Latest step's clue — highlight as "active" during streaming
    const isActive = steps.length > 0 && steps[steps.length - 1]?.clue_id === clue.id
    const hasFill = filled && !filled.includes('_')
    const itemRef = useRef<HTMLButtonElement>(null)

    // Auto-scroll into view when this clue becomes active
    useEffect(() => {
      if (isActive && itemRef.current) {
        itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }, [isActive])

    return (
      <button
        ref={itemRef}
        onClick={() => onSelectClue(clue.id)}
        className={`text-left w-full px-2 py-1 rounded text-xs transition-colors ${
          isSelected
            ? 'bg-blue-100 text-blue-900 font-semibold'
            : isActive
            ? 'bg-yellow-50 text-yellow-900 ring-1 ring-yellow-300'
            : 'hover:bg-gray-100 text-gray-700'
        }`}
      >
        <span className="font-bold mr-1">{clue.number}.</span>
        <span className="mr-1">{clue.text}</span>
        {hasFill && step?.action !== 'skip' && (
          <span className="text-green-600 font-mono font-bold ml-1">({filled})</span>
        )}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Selected clue detail card */}
      {selectedClue && (
        <div className="bg-white border border-blue-200 rounded-lg p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              {selectedClue.id}
            </span>
            <span className="text-xs text-gray-500">{selectedClue.length} letters</span>
            {selectedStep && (
              <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded ${
                selectedStep.action === 'fill'   ? 'bg-green-100 text-green-700' :
                selectedStep.action === 'repair' ? 'bg-orange-100 text-orange-700' :
                selectedStep.action === 'skip'   ? 'bg-gray-100 text-gray-500' :
                'bg-gray-100 text-gray-500'
              }`}>
                {selectedStep.action.toUpperCase()}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-800 mb-2">"{selectedClue.text}"</p>
          {selectedStep?.candidates && selectedStep.candidates.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedStep.candidates.map((c, i) => (
                <span
                  key={i}
                  className={`px-1.5 py-0.5 rounded font-mono text-xs ${
                    c === selectedStep.chosen
                      ? 'bg-green-500 text-white font-bold'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          {selectedStep?.note && (
            <p className="text-xs text-gray-400 mt-2">{selectedStep.note}</p>
          )}
        </div>
      )}

      {/* Across / Down two-column list */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Across</h3>
          <div className="flex flex-col gap-0.5">
            {across.map((c) => <ClueItem key={c.id} clue={c} />)}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Down</h3>
          <div className="flex flex-col gap-0.5">
            {down.map((c) => <ClueItem key={c.id} clue={c} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
