// ── Benchmark types ──────────────────────────────────────────────────────────

export interface BenchmarkStartEvent {
  type: 'start'
  model: string
  puzzle: string
}

export interface BenchmarkResultEvent {
  type: 'result'
  model: string
  puzzle: string
  run_id: string
  words_correct: number
  total_words: number
  word_pct: number
  clues_blank: number
  clues_wrong: number
  correct_letters: number
  total_letters: number
  letter_pct: number
  naive_correct: number
  naive_word_pct: number
  elapsed_s: number
}

export interface BenchmarkErrorEvent {
  type: 'error'
  model: string
  puzzle: string
  error: string
  elapsed_s: number
}

export interface BenchmarkDoneEvent {
  type: 'done'
  run_id: string
}

export type BenchmarkEvent =
  | BenchmarkStartEvent
  | BenchmarkResultEvent
  | BenchmarkErrorEvent
  | BenchmarkDoneEvent

/** One cell in the results matrix: (model, puzzle) */
export interface BenchmarkCell {
  status: 'pending' | 'running' | 'done' | 'error'
  word_pct?: number
  letter_pct?: number
  words_correct?: number
  total_words?: number
  clues_blank?: number
  clues_wrong?: number
  naive_correct?: number
  naive_word_pct?: number
  elapsed_s?: number
  error?: string
}

export interface BenchmarkModelSummary {
  model: string
  label: string
  avg_word_pct: number
  avg_letter_pct: number
  avg_naive_pct: number
  avg_blank_pct: number
  avg_wrong_pct: number
  avg_elapsed_s: number
  puzzles_done: number
  total_puzzles: number
}

/** A saved run loaded from /benchmark/results */
export interface SavedRun {
  id: string
  oracle: boolean
  web_search: boolean
  models: string[]
  results: Record<string, Record<string, Omit<BenchmarkCell, 'status'> & { word_pct: number; letter_pct: number }>>
}

export interface BenchmarkModel {
  id: string
  name: string
  label: string
}

// ── Solver types ──────────────────────────────────────────────────────────────

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
