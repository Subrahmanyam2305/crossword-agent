import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BenchmarkCell,
  BenchmarkEvent,
  BenchmarkModel,
  BenchmarkModelSummary,
  SavedRun,
} from '../types'

export type BenchmarkStatus = 'idle' | 'running' | 'done' | 'error'
export type ResultsMatrix = Record<string, Record<string, BenchmarkCell>>

const MODEL_LABELS: Record<string, string> = {
  'kimi-k3':         'Kimi K3',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'gpt-oss-120b':    'GPT OSS 120B',
  'qwen3-5-397b':    'Qwen 3.5 397B',
  'nemotron-super':  'Nemotron Super 120B',
  'glm-5-3':         'GLM 5.3',
}

export function useBenchmark() {
  const [status, setStatus] = useState<BenchmarkStatus>('idle')
  const [results, setResults] = useState<ResultsMatrix>({})
  const [puzzleIds, setPuzzleIds] = useState<string[]>([])
  const [modelKeys, setModelKeys] = useState<string[]>([])
  const [availableModels, setAvailableModels] = useState<BenchmarkModel[]>([])
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  // Load available models + saved runs on mount
  useEffect(() => {
    fetch('/benchmark/models')
      .then((r) => r.json())
      .then((data: BenchmarkModel[]) => setAvailableModels(data))
      .catch(() => {})

    fetch('/benchmark/results')
      .then((r) => r.json())
      .then((data: { runs: SavedRun[] }) => {
        setSavedRuns(data.runs ?? [])
        // Auto-load the latest run if any
        if (data.runs?.length > 0) {
          loadRun(data.runs[data.runs.length - 1])
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Load a previously saved run into the results matrix */
  const loadRun = useCallback((run: SavedRun) => {
    const matrix: ResultsMatrix = {}
    const puzzles = new Set<string>()
    for (const [model, byPuzzle] of Object.entries(run.results)) {
      matrix[model] = {}
      for (const [puzzle, cell] of Object.entries(byPuzzle)) {
        matrix[model][puzzle] = { ...cell, status: 'done' }
        puzzles.add(puzzle)
      }
    }
    setResults(matrix)
    setModelKeys(run.models)
    setPuzzleIds([...puzzles].sort())
    setActiveRunId(run.id)
    setStatus('idle')
  }, [])

  const start = useCallback((models: string[], oracle: boolean, webSearch: boolean) => {
    esRef.current?.close()
    setError(null)
    setModelKeys(models)
    setPuzzleIds([])
    const initial: ResultsMatrix = {}
    for (const m of models) initial[m] = {}
    setResults(initial)
    setStatus('running')

    const params = new URLSearchParams({ models: models.join(',') })
    if (oracle) params.set('oracle', 'true')
    if (webSearch) params.set('web_search', 'true')

    const es = new EventSource(`/benchmark?${params}`)
    esRef.current = es

    es.onmessage = (event) => {
      const msg: BenchmarkEvent = JSON.parse(event.data)

      if (msg.type === 'done') {
        es.close()
        setStatus('done')
        setActiveRunId(msg.run_id)
        // Refresh saved runs list
        fetch('/benchmark/results')
          .then((r) => r.json())
          .then((data: { runs: SavedRun[] }) => setSavedRuns(data.runs ?? []))
          .catch(() => {})
        return
      }

      if (msg.type === 'start') {
        setPuzzleIds((prev) =>
          prev.includes(msg.puzzle) ? prev : [...prev, msg.puzzle].sort()
        )
        setResults((prev) => ({
          ...prev,
          [msg.model]: { ...prev[msg.model], [msg.puzzle]: { status: 'running' } },
        }))
        return
      }

      if (msg.type === 'result') {
        setResults((prev) => ({
          ...prev,
          [msg.model]: {
            ...prev[msg.model],
            [msg.puzzle]: {
              status: 'done',
              word_pct: msg.word_pct,
              letter_pct: msg.letter_pct,
              words_correct: msg.words_correct,
              total_words: msg.total_words,
              clues_blank: msg.clues_blank,
              clues_wrong: msg.clues_wrong,
              naive_correct: msg.naive_correct,
              naive_word_pct: msg.naive_word_pct,
              elapsed_s: msg.elapsed_s,
            },
          },
        }))
        return
      }

      if (msg.type === 'error') {
        setResults((prev) => ({
          ...prev,
          [msg.model]: {
            ...prev[msg.model],
            [msg.puzzle]: { status: 'error', elapsed_s: msg.elapsed_s, error: msg.error },
          },
        }))
      }
    }

    es.onerror = () => {
      es.close()
      setStatus('error')
      setError('Connection lost. Is the backend running?')
    }
  }, [])

  const stop = useCallback(() => {
    esRef.current?.close()
    setStatus('idle')
  }, [])

  /** Per-model averages over completed cells */
  const summaries: BenchmarkModelSummary[] = modelKeys.map((model) => {
    const cells = Object.values(results[model] ?? {}).filter((c) => c.status === 'done')
    const avg = (fn: (c: BenchmarkCell) => number) =>
      cells.length ? Math.round((cells.reduce((s, c) => s + fn(c), 0) / cells.length) * 10) / 10 : 0

    return {
      model,
      label: MODEL_LABELS[model] ?? model,
      avg_word_pct: avg((c) => c.word_pct ?? 0),
      avg_letter_pct: avg((c) => c.letter_pct ?? 0),
      avg_naive_pct: avg((c) => c.naive_word_pct ?? 0),
      avg_blank_pct: avg((c) =>
        c.total_words ? ((c.clues_blank ?? 0) / c.total_words) * 100 : 0
      ),
      avg_wrong_pct: avg((c) =>
        c.total_words ? ((c.clues_wrong ?? 0) / c.total_words) * 100 : 0
      ),
      avg_elapsed_s: avg((c) => c.elapsed_s ?? 0),
      puzzles_done: cells.length,
      total_puzzles: puzzleIds.length,
    }
  })

  return {
    status, results, puzzleIds, modelKeys, summaries,
    availableModels, savedRuns, activeRunId,
    error, start, stop, loadRun,
  }
}
