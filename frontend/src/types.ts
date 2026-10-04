export interface Clue {
  id: string
  text: string
  start: [number, number]
  direction: string
  length: number
  number: number
}

export interface PuzzleMeta {
  id: string
  title: string
  size: string
  clues: number
}

export interface PuzzleDetail {
  id: string
  title: string
  rows: number
  cols: number
  grid: string[][]
  clues: Clue[]
}

export interface SolveStep {
  phase: number
  clue_id: string
  clue_text: string
  length: number
  pattern: string
  candidates: string[]
  chosen: string | null
  action: 'candidates' | 'fill' | 'skip' | 'repair' | 'conflict' | 'converged' | 'done' | 'stream_end'
  grid_snapshot: string[][]
  iteration: number
  note: string
}
