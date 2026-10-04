import type { Clue, SolveStep } from '../types'

interface Props {
  grid: string[][]
  rows: number
  cols: number
  clues: Clue[]
  latestStep: SolveStep | null
  selectedClueId: string | null
  onSelectClue: (clueId: string | null) => void
}

/** Build a map from "row,col" → grid number label */
function buildNumMap(clues: Clue[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of clues) {
    const key = `${c.start[0]},${c.start[1]}`
    if (!m.has(key)) m.set(key, c.number)
  }
  return m
}

/** Return all (row,col) cells occupied by a clue */
function clueCells(clue: Clue): Set<string> {
  const s = new Set<string>()
  for (let i = 0; i < clue.length; i++) {
    const r = clue.start[0] + (clue.direction === 'D' ? i : 0)
    const c = clue.start[1] + (clue.direction === 'A' ? i : 0)
    s.add(`${r},${c}`)
  }
  return s
}

export default function CrosswordGrid({
  grid, rows, cols, clues, latestStep, selectedClueId, onSelectClue,
}: Props) {
  if (!grid.length) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg w-[420px]">
        Select a puzzle and click Solve
      </div>
    )
  }

  /** Build tooltip: "1A: Bee ball? / 1D: Swarm leader?" for a given cell */
  function cellTooltip(r: number, c: number): string {
    const key = `${r},${c}`
    const covering = clues.filter((cl) => clueCells(cl).has(key))
    return covering.map((cl) => `${cl.id}: ${cl.text}`).join('\n')
  }

  const numMap = buildNumMap(clues)

  // Cells belonging to the selected clue
  const selectedCells = new Set<string>()
  if (selectedClueId) {
    const sc = clues.find((c) => c.id === selectedClueId)
    if (sc) clueCells(sc).forEach((k) => selectedCells.add(k))
  }

  // Cells belonging to the latest agent step's clue (animation highlight)
  const activeCells = new Set<string>()
  if (latestStep?.clue_id) {
    const ac = clues.find((c) => c.id === latestStep.clue_id)
    if (ac) clueCells(ac).forEach((k) => activeCells.add(k))
  }
  const activeAction = latestStep?.action

  function handleCellClick(r: number, c: number) {
    if (!clues.length) return
    const key = `${r},${c}`
    if (grid[r]?.[c] === '#') return

    // Find clues that cover this cell
    const covering = clues.filter((cl) => clueCells(cl).has(key))
    if (!covering.length) return

    // If one of them is already selected, toggle to the other direction
    const already = covering.find((cl) => cl.id === selectedClueId)
    if (already) {
      const other = covering.find((cl) => cl.id !== selectedClueId)
      onSelectClue(other ? other.id : null)
    } else {
      // Prefer across, fall back to down
      const across = covering.find((cl) => cl.direction === 'A')
      onSelectClue(across ? across.id : covering[0].id)
    }
  }

  function cellClass(r: number, c: number): string {
    const cell = grid[r]?.[c]
    if (cell === '#') return 'w-9 h-9 bg-gray-900'

    const key = `${r},${c}`
    const isSelected = selectedCells.has(key)
    const isActive = activeCells.has(key)

    const base = 'relative w-9 h-9 border border-gray-400 flex items-center justify-center font-bold text-sm uppercase cursor-pointer select-none transition-colors duration-150'

    if (isSelected && isActive) return `${base} bg-yellow-200 border-yellow-500`
    if (isSelected) return `${base} bg-blue-200 border-blue-600 shadow-inner`
    if (isActive) {
      if (activeAction === 'conflict') return `${base} bg-red-100 border-red-400`
      if (activeAction === 'repair')   return `${base} bg-green-100 border-green-400`
      if (activeAction === 'fill')     return `${base} bg-yellow-50 border-yellow-400`
      return `${base} bg-gray-50`
    }
    return `${base} bg-white`
  }

  return (
    <div className="inline-block border-2 border-gray-800 rounded shadow-lg">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex">
          {Array.from({ length: cols }, (_, c) => {
            const cell = grid[r]?.[c]
            const isBlack = cell === '#'
            const numLabel = !isBlack ? numMap.get(`${r},${c}`) : undefined

            return (
              <div
                key={c}
                className={cellClass(r, c)}
                onClick={() => handleCellClick(r, c)}
                title={!isBlack ? cellTooltip(r, c) : undefined}
              >
                {!isBlack && numLabel !== undefined && (
                  <span className="absolute top-[1px] left-[2px] text-[8px] font-semibold text-gray-500 leading-none">
                    {numLabel}
                  </span>
                )}
                {!isBlack && cell && (
                  <span className="mt-1">{cell}</span>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
