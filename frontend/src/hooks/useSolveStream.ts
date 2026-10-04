import { useCallback, useRef, useState } from 'react'
import type { Clue, PuzzleDetail, SolveStep } from '../types'

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'error'

export function useSolveStream() {
  const [steps, setSteps] = useState<SolveStep[]>([])
  const [status, setStatus] = useState<StreamStatus>('idle')
  const [grid, setGrid] = useState<string[][]>([])
  const [puzzle, setPuzzle] = useState<PuzzleDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const loadPuzzle = useCallback(async (puzzleId: string) => {
    try {
      const res = await fetch(`/puzzles/${puzzleId}`)
      const detail: PuzzleDetail = await res.json()
      setPuzzle(detail)
      setGrid(detail.grid)
      setSteps([])
      setStatus('idle')
      setError(null)
    } catch {
      setPuzzle(null)
    }
  }, [])

  const start = useCallback(async (puzzleId: string, model: string, webSearch = false, oracle = false) => {
    esRef.current?.close()
    setSteps([])
    setError(null)
    setStatus('streaming')

    // Fetch puzzle detail first so we have clues/positions for the grid UI
    try {
      const res = await fetch(`/puzzles/${puzzleId}`)
      const detail: PuzzleDetail = await res.json()
      setPuzzle(detail)
      setGrid(detail.grid)
    } catch {
      setPuzzle(null)
    }

    const params = new URLSearchParams({ model })
    if (webSearch) params.set('web_search', 'true')
    if (oracle) params.set('oracle', 'true')
    const es = new EventSource(`/solve/${puzzleId}?${params}`)
    esRef.current = es

    es.onmessage = (event) => {
      const step: SolveStep = JSON.parse(event.data)
      if (step.action === 'stream_end') {
        es.close()
        setStatus('done')
        return
      }
      setSteps((prev) => [...prev, step])
      if (step.grid_snapshot?.length > 0) setGrid(step.grid_snapshot)
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

  return { steps, status, grid, setGrid, puzzle, error, start, stop, loadPuzzle }
}
