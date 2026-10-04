import { useRef, useEffect } from 'react'
import type { Clue, SolveStep } from '../types'

interface Props {
  grid: string[][]
  rows: number
  cols: number
  clues: Clue[]
  latestStep: SolveStep | null
  selectedClueId: string | null
  onSelectClue: (clueId: string | null) => void
  onCellEdit: ((row: number, col: number, value: string) => void) | null
}

function buildNumMap(clues: Clue[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of clues) {
    const key = `${c.start[0]},${c.start[1]}`
    if (!m.has(key)) m.set(key, c.number)
  }
  return m
}

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
  grid, rows, cols, clues, latestStep, selectedClueId, onSelectClue, onCellEdit,
}: Props) {
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const focusedCell = useRef<string | null>(null)

  if (!grid.length) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg w-[420px]">
        Select a puzzle to preview the grid
      </div>
    )
  }

  const isEditable = onCellEdit !== null

  function cellTooltip(r: number, c: number): string {
    const key = `${r},${c}`
    const covering = clues.filter((cl) => clueCells(cl).has(key))
    return covering.map((cl) => `${cl.id}: ${cl.text}`).join('\n')
  }

  const numMap = buildNumMap(clues)

  const selectedCells = new Set<string>()
  const selectedClue = selectedClueId ? clues.find((c) => c.id === selectedClueId) : null
  if (selectedClue) clueCells(selectedClue).forEach((k) => selectedCells.add(k))

  const activeCells = new Set<string>()
  if (latestStep?.clue_id) {
    const ac = clues.find((c) => c.id === latestStep.clue_id)
    if (ac) clueCells(ac).forEach((k) => activeCells.add(k))
  }
  const activeAction = latestStep?.action

  function findCluesAt(r: number, c: number) {
    const key = `${r},${c}`
    return clues.filter((cl) => clueCells(cl).has(key))
  }

  function handleCellClick(r: number, c: number) {
    if (!clues.length) return
    if (grid[r]?.[c] === '#') return

    const covering = findCluesAt(r, c)
    if (!covering.length) return

    const already = covering.find((cl) => cl.id === selectedClueId)
    if (already) {
      const other = covering.find((cl) => cl.id !== selectedClueId)
      onSelectClue(other ? other.id : null)
    } else {
      const across = covering.find((cl) => cl.direction === 'A')
      onSelectClue(across ? across.id : covering[0].id)
    }

    if (isEditable) {
      const key = `${r},${c}`
      focusedCell.current = key
      setTimeout(() => inputRefs.current.get(key)?.focus(), 0)
    }
  }

  function advanceToNext(r: number, c: number) {
    if (!selectedClue) return
    const dir = selectedClue.direction
    const nr = dir === 'D' ? r + 1 : r
    const nc = dir === 'A' ? c + 1 : c
    if (nr >= rows || nc >= cols) return
    if (grid[nr]?.[nc] === '#') return
    const key = `${nr},${nc}`
    focusedCell.current = key
    setTimeout(() => inputRefs.current.get(key)?.focus(), 0)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    if (!onCellEdit) return

    if (e.key === 'Backspace') {
      e.preventDefault()
      const current = grid[r]?.[c]
      if (current && current !== '' && current !== '#') {
        onCellEdit(r, c, '')
      } else {
        // Move back
        if (!selectedClue) return
        const dir = selectedClue.direction
        const pr = dir === 'D' ? r - 1 : r
        const pc = dir === 'A' ? c - 1 : c
        if (pr < 0 || pc < 0) return
        const key = `${pr},${pc}`
        focusedCell.current = key
        onCellEdit(pr, pc, '')
        setTimeout(() => inputRefs.current.get(key)?.focus(), 0)
      }
      return
    }

    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault()
      onCellEdit(r, c, e.key.toUpperCase())
      advanceToNext(r, c)
      return
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
      const dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      const nr = r + dr
      const nc = c + dc
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr]?.[nc] !== '#') {
        const key = `${nr},${nc}`
        focusedCell.current = key
        setTimeout(() => inputRefs.current.get(key)?.focus(), 0)
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      advanceToNext(r, c)
    }
  }

  function cellClass(r: number, c: number): string {
    const cell = grid[r]?.[c]
    if (cell === '#') return 'w-9 h-9 bg-gray-900'

    const key = `${r},${c}`
    const isSelected = selectedCells.has(key)
    const isActive = activeCells.has(key)
    const isFocused = focusedCell.current === key

    const base = 'relative w-9 h-9 border border-gray-400 flex items-center justify-center font-bold text-sm uppercase cursor-pointer select-none transition-colors duration-150'

    if (isFocused && isEditable) return `${base} bg-blue-300 border-blue-600 ring-2 ring-blue-400 ring-inset`
    if (isSelected && isActive) return `${base} bg-yellow-200 border-yellow-500`
    if (isSelected) return `${base} bg-blue-100 border-blue-500`
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
            const key = `${r},${c}`

            return (
              <div
                key={c}
                className={cellClass(r, c)}
                onClick={() => handleCellClick(r, c)}
                title={!isBlack ? cellTooltip(r, c) : undefined}
              >
                {!isBlack && numLabel !== undefined && (
                  <span className="absolute top-[1px] left-[2px] text-[8px] font-semibold text-gray-500 leading-none pointer-events-none">
                    {numLabel}
                  </span>
                )}
                {!isBlack && isEditable ? (
                  <input
                    ref={(el) => { if (el) inputRefs.current.set(key, el); else inputRefs.current.delete(key) }}
                    className="w-full h-full bg-transparent text-center font-bold text-sm uppercase outline-none caret-transparent cursor-pointer"
                    value={cell && cell !== '#' ? cell : ''}
                    readOnly
                    onKeyDown={(e) => handleKeyDown(e, r, c)}
                    onFocus={() => { focusedCell.current = key }}
                    tabIndex={-1}
                  />
                ) : (
                  !isBlack && cell && cell !== '#' && (
                    <span className="mt-1">{cell}</span>
                  )
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
