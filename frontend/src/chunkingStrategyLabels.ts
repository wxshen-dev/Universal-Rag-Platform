export const CHUNKING_STRATEGY_LABELS: Record<string, string> = {
  fixed: 'Fixed length',
  structural: 'Structural',
  'table-aware': 'Table-aware',
  'parent-child': 'Parent-child',
  semantic: 'Semantic',
  'chat-record': 'Chat record',
}

export const RETRIEVAL_STRATEGY_LABELS: Record<string, string> = {
  dense: 'Dense retrieval',
  hybrid: 'Hybrid retrieval',
}

export function getChunkingStrategyLabel(name?: string | null) {
  if (!name) return 'Fixed length'
  return CHUNKING_STRATEGY_LABELS[name] ?? name
}

export function getRetrievalStrategyLabel(name?: string | null) {
  if (!name) return 'Dense retrieval'
  return RETRIEVAL_STRATEGY_LABELS[name] ?? name
}

export function getStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    pending: 'Pending',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
  }
  return labels[status || ''] ?? status ?? 'Unknown'
}
