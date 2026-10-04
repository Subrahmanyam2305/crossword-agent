import { useEffect, useMemo, useState } from 'react'
import AgentLog from './components/AgentLog'
import ClueList from './components/ClueList'
import CrosswordGrid from './components/CrosswordGrid'
import PuzzlePicker from './components/PuzzlePicker'
import { useSolveStream } from './hooks/useSolveStream'

export default function App() {
  const { steps, status, grid, puzzle, error, start } = useSolveStream()
  const [selectedClueId, setSelectedClueId] = useState<string | null>(null)
  const isStreaming = status === 'streaming'

  const latestStep = steps.length > 0 ? steps[steps.length - 1] : null

  const dims = useMemo(() => {
    const g = grid.length > 0 ? grid : puzzle?.grid
    if (!g || g.length === 0) return { rows: 15, cols: 15 }
    return { rows: g.length, cols: g[0]?.length ?? 15 }
  }, [grid, puzzle])

  const clues = puzzle?.clues ?? []
  const doneNote = steps.find((s) => s.action === 'done')?.note ?? null
  const repairs   = steps.filter((s) => s.action === 'repair').length
  const conflicts = steps.filter((s) => s.action === 'conflict').length

  // Auto-select the clue the agent just filled/repaired so the detail card stays in sync
  useEffect(() => {
    if (latestStep?.clue_id && (latestStep.action === 'fill' || latestStep.action === 'repair')) {
      setSelectedClueId(latestStep.clue_id)
    }
  }, [latestStep])

  // When the agent fills/repairs a clue, auto-select it so the clue detail shows
  const highlightStep = latestStep?.clue_id ? latestStep : null

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4 shadow-sm">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Crossword Agent</h1>
          <p className="text-xs text-gray-500">Nebius Token Factory · 3-Phase Constraint Solver</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {puzzle && <span className="text-xs text-gray-400">{puzzle.title}</span>}
          {isStreaming && (
            <div className="flex items-center gap-2 text-blue-600 text-sm font-medium">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              Solving…
            </div>
          )}
          {status === 'done' && <span className="text-green-600 text-sm font-medium">✓ Done</span>}
          {status === 'error' && <span className="text-red-500 text-sm">{error}</span>}
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-3 flex flex-col gap-4">
        <PuzzlePicker
          onSelect={(puzzleId, model, webSearch, oracle) => { setSelectedClueId(null); start(puzzleId, model, webSearch, oracle) }}
          disabled={isStreaming}
        />

        {/* ── Top row: grid + clues ── */}
        <div className="flex gap-6 items-start justify-center">
          {/* Grid + legend + stats */}
          <div className="flex flex-col gap-3 shrink-0">
            <CrosswordGrid
              grid={grid.length > 0 ? grid : (puzzle?.grid ?? [])}
              rows={dims.rows}
              cols={dims.cols}
              clues={clues}
              latestStep={highlightStep}
              selectedClueId={selectedClueId}
              onSelectClue={setSelectedClueId}
            />

            {/* Legend */}
            <div className="flex gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm bg-blue-100 border border-blue-400 inline-block" />Selected
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm bg-yellow-50 border border-yellow-400 inline-block" />Filling
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm bg-red-100 border border-red-400 inline-block" />Conflict
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm bg-green-100 border border-green-400 inline-block" />Repair
              </span>
            </div>

            {/* Stats */}
            {steps.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm shadow-sm">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-2xl font-bold text-blue-600">
                      {steps.filter((s) => s.action === 'candidates').length}
                    </div>
                    <div className="text-gray-400 text-xs">Clues</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-red-500">{conflicts}</div>
                    <div className="text-gray-400 text-xs">Conflicts</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-600">{repairs}</div>
                    <div className="text-gray-400 text-xs">Repairs</div>
                  </div>
                </div>
                {doneNote && (
                  <p className="mt-2 text-gray-600 text-center text-xs font-medium">{doneNote}</p>
                )}
              </div>
            )}
          </div>

          {/* Clue list */}
          {clues.length > 0 && (
            <div className="w-80 shrink-0 overflow-y-auto" style={{maxHeight: 'calc(100vh - 160px)'}}>
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
                Clues <span className="text-gray-400 font-normal">(click to inspect)</span>
              </h2>
              <ClueList
                clues={clues}
                steps={steps}
                grid={grid}
                selectedClueId={selectedClueId}
                onSelectClue={setSelectedClueId}
              />
            </div>
          )}
        </div>

        {/* ── Bottom: agent log horizontal scroll strip ── */}
        {steps.length > 0 && (
          <div className="mt-2">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
              Agent Decision Log
            </h2>
            <div className="overflow-x-auto pb-3" style={{height: '200px'}}>
              <AgentLog steps={steps} />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
