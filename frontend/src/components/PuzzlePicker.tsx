import { useEffect, useState } from 'react'
import type { PuzzleMeta } from '../types'

interface Props {
  onSelect: (puzzleId: string, model: string, webSearch: boolean, oracle: boolean) => void
  onPuzzleChange: (puzzleId: string) => void
  disabled: boolean
}

const MODEL_OPTIONS = [
  { id: 'kimi-k3',             label: 'Kimi K3' },
  { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
  { id: 'glm-5-3',             label: 'GLM 5.3' },
  { id: 'minimax-m3',          label: 'MiniMax M3' },
  { id: 'hermes-4-405b',       label: 'Hermes 4 405B' },
  { id: 'nemotron-ultra-550b', label: 'Nemotron Ultra 550B' },
]

export default function PuzzlePicker({ onSelect, onPuzzleChange, disabled }: Props) {
  const [puzzles, setPuzzles] = useState<PuzzleMeta[]>([])
  const [selectedPuzzle, setSelectedPuzzle] = useState('')
  const [selectedModel, setSelectedModel] = useState('kimi-k3')
  const [webSearch, setWebSearch] = useState(false)
  const [oracle, setOracle] = useState(false)

  useEffect(() => {
    fetch('/puzzles')
      .then((r) => r.json())
      .then((data) => {
        setPuzzles(data)
        if (data.length > 0) {
          setSelectedPuzzle(data[0].id)
          onPuzzleChange(data[0].id)
        }
      })
      .catch(() => {})
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleSolve = () => {
    if (selectedPuzzle) onSelect(selectedPuzzle, selectedModel, webSearch, oracle)
  }

  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500 font-medium uppercase tracking-wide">Puzzle</label>
        <select
          value={selectedPuzzle}
          onChange={(e) => {
            setSelectedPuzzle(e.target.value)
            onPuzzleChange(e.target.value)
          }}
          disabled={disabled}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
        >
          {puzzles.length === 0 && (
            <option value="">No puzzles found</option>
          )}
          {puzzles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} ({p.size})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500 font-medium uppercase tracking-wide">Model</label>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={disabled}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Web search toggle */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500 font-medium uppercase tracking-wide">Options</label>
        <div className="flex gap-2">
          <label className={`flex items-center gap-2 border rounded-md px-3 py-2 text-sm cursor-pointer select-none transition-colors ${
            webSearch
              ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
              : 'bg-white border-gray-300 text-gray-500'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-emerald-300'}`}>
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
              disabled={disabled}
              className="accent-emerald-500"
            />
            <span>Web search</span>
          </label>

          <label className={`flex items-center gap-2 border rounded-md px-3 py-2 text-sm cursor-pointer select-none transition-colors ${
            oracle
              ? 'bg-amber-50 border-amber-400 text-amber-700'
              : 'bg-white border-gray-300 text-gray-500'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-amber-300'}`}>
            <input
              type="checkbox"
              checked={oracle}
              onChange={(e) => setOracle(e.target.checked)}
              disabled={disabled}
              className="accent-amber-500"
            />
            <span>Auto-check</span>
          </label>
        </div>
      </div>

      <button
        onClick={handleSolve}
        disabled={disabled || !selectedPuzzle}
        className="px-5 py-2 bg-blue-600 text-white rounded-md font-semibold text-sm shadow hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {disabled ? 'Solving...' : 'Solve'}
      </button>
    </div>
  )
}
