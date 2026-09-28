import { useEffect, useState, type FormEvent } from 'react'
import {
  createEvaluationDataset,
  createEvaluationRun,
  deleteEvaluationDataset,
  deleteEvaluationRun,
  fetchChunkingStrategies,
  fetchEvaluationDatasetDetail,
  fetchEvaluationDatasets,
  fetchEvaluationRunDetail,
  fetchEvaluationRuns,
  fetchRetrievalStrategies,
} from '../api'
import { getChunkingStrategyLabel, getRetrievalStrategyLabel, getStatusLabel } from '../chunkingStrategyLabels'
import { FormField, SectionHeader } from '../components/shared'
import { formatDateTime } from '../utils'
import type { ChunkingStrategyInfo, EvaluationDataset, EvaluationDatasetDetail, EvaluationRun, EvaluationRunDetail, RetrievalStrategyInfo } from '../types'

type Tab = 'datasets' | 'runs'

export function EvaluationPage() {
  const [tab, setTab] = useState<Tab>('datasets')
  const [datasets, setDatasets] = useState<EvaluationDataset[]>([])
  const [selectedDataset, setSelectedDataset] = useState<EvaluationDatasetDetail | null>(null)
  const [runs, setRuns] = useState<EvaluationRun[]>([])
  const [selectedRun, setSelectedRun] = useState<EvaluationRunDetail | null>(null)
  const [chunkStrats, setChunkStrats] = useState<ChunkingStrategyInfo[]>([])
  const [retrStrats, setRetrStrats] = useState<RetrievalStrategyInfo[]>([])
  const [creating, setCreating] = useState(false)
  const [running, setRunning] = useState(false)
  const [queryCount, setQueryCount] = useState(0)
  const [runDatasetUuid, setRunDatasetUuid] = useState('')

  // Dataset form
  const [dsForm, setDsForm] = useState({ name: '', description: '' })
  const [jsonlText, setJsonlText] = useState('')

  // Run form
  const [runForm, setRunForm] = useState({
    dataset_uuid: '',
    chunking_strategy: 'fixed',
    retrieval_strategy: 'dense',
    fusion_alpha: 0.7,
  })

  useEffect(() => {
    void refreshDatasets()
  }, [])
  useEffect(() => {
    fetchChunkingStrategies().then((d) => setChunkStrats(d.strategies)).catch(() => undefined)
    fetchRetrievalStrategies().then((d) => setRetrStrats(d.strategies)).catch(() => undefined)
  }, [])

  async function refreshDatasets() {
    try {
      setDatasets(await fetchEvaluationDatasets())
    } catch {
      return
    }
  }

  async function refreshRuns(datasetUuid?: string) {
    try {
      setRuns(await fetchEvaluationRuns(datasetUuid ? { dataset_uuid: datasetUuid } : undefined))
    } catch {
      return
    }
  }

  async function handleCreateDataset(event: FormEvent) {
    event.preventDefault()
    if (!dsForm.name.trim()) return
    setCreating(true)
    try {
      const queries = parseJsonl(jsonlText)
      await createEvaluationDataset({ name: dsForm.name.trim(), description: dsForm.description.trim(), queries })
      setDsForm({ name: '', description: '' })
      setJsonlText('')
      setQueryCount(0)
      await refreshDatasets()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Creation failed')
    } finally {
      setCreating(false)
    }
  }

  async function handleViewDataset(uuid: string) {
    try {
      setSelectedDataset(await fetchEvaluationDatasetDetail(uuid))
    } catch {
      return
    }
  }

  async function handleDeleteDataset(uuid: string) {
    if (!window.confirm('Delete this evaluation dataset?')) return
    try {
      await deleteEvaluationDataset(uuid)
      setSelectedDataset(null)
      await refreshDatasets()
    } catch {
      return
    }
  }

  async function handleCreateRun(event: FormEvent) {
    event.preventDefault()
    if (!runForm.dataset_uuid.trim()) return
    setRunning(true)
    try {
      await createEvaluationRun({
        dataset_uuid: runForm.dataset_uuid.trim(),
        chunking_strategy: runForm.chunking_strategy,
        retrieval_strategy: runForm.retrieval_strategy,
        retrieval_params: runForm.retrieval_strategy === 'hybrid' ? { fusion_alpha: runForm.fusion_alpha } : undefined,
      })
      await refreshRuns(runForm.dataset_uuid.trim())
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to start evaluation')
    } finally {
      setRunning(false)
    }
  }

  async function handleViewRun(uuid: string) {
    try {
      setSelectedRun(await fetchEvaluationRunDetail(uuid))
    } catch {
      return
    }
  }

  async function handleDeleteRun(uuid: string) {
    if (!window.confirm('Delete this evaluation run?')) return
    try {
      await deleteEvaluationRun(uuid)
      if (selectedRun?.run_uuid === uuid) setSelectedRun(null)
      await refreshRuns(runDatasetUuid || undefined)
    } catch {
      return
    }
  }

  function parseJsonl(raw: string) {
    if (!raw.trim()) return []
    const lines = raw.trim().split('\n').filter(Boolean)
    return lines.map((line, i) => {
      try {
        const obj = JSON.parse(line)
        return {
          query_text: String(obj.query ?? obj.query_text ?? ''),
          expected_doc_titles: Array.isArray(obj.expected_doc_titles) ? obj.expected_doc_titles.map(String) : [],
          expected_terms: Array.isArray(obj.expected_terms) ? obj.expected_terms.map(String) : [],
          notes: obj.notes ? String(obj.notes) : undefined,
        }
      } catch { throw new Error(`Could not parse JSON on line ${i + 1}`) }
    })
  }

  function handleJsonlChange(text: string) {
    setJsonlText(text)
    if (!text.trim()) { setQueryCount(0); return }
    try { setQueryCount(parseJsonl(text).length) } catch { setQueryCount(-1) }
  }

  return (
    <>
      <section className="panel hero-panel compact-hero evaluation-hero">
        <div className="hero-copy">
          <p className="eyebrow">Evaluation</p>
          <h2>Evaluation Workspace</h2>
          <p className="muted">Manage datasets, run evaluations, and compare metrics. Evaluation data is isolated from production data.</p>
        </div>
        <div className="hero-actions hero-actions-inline">
          <div className="tab-switcher" role="tablist" aria-label="Evaluation workspace tabs">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'datasets'}
              className={`tab-switch-button ${tab === 'datasets' ? 'active' : ''}`}
              onClick={() => setTab('datasets')}
            >
              Datasets
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'runs'}
              className={`tab-switch-button ${tab === 'runs' ? 'active' : ''}`}
              onClick={() => { setTab('runs'); void refreshRuns() }}
            >
              Evaluation runs
            </button>
          </div>
        </div>
      </section>

      {tab === 'datasets' ? (
        <section className="grid two-up">
          <article className="panel">
            <SectionHeader eyebrow="Evaluation" title="Create Dataset" />
            <form className="form-grid" onSubmit={handleCreateDataset}>
              <FormField label="Name"><input type="text" value={dsForm.name} onChange={(e) => setDsForm((c) => ({ ...c, name: e.target.value }))} placeholder="Example: Customer support knowledge evaluation" /></FormField>
              <FormField label="Description"><input type="text" value={dsForm.description} onChange={(e) => setDsForm((c) => ({ ...c, description: e.target.value }))} placeholder="Example: Evaluate retrieval quality for support queries" /></FormField>
              <FormField label="Query List (JSONL)" spanTwo helpText='One JSON object per line. The query field is required; expected_doc_titles and expected_terms are optional.'>
                <textarea className="text-area" rows={8} value={jsonlText} onChange={(e) => handleJsonlChange(e.target.value)} placeholder={`Example:
{"query":"customer support ticket system","expected_doc_titles":["Support Guide"],"expected_terms":["ticket","support"]}
{"query":"travel approval process","expected_doc_titles":["Travel Policy"],"expected_terms":["travel","approval"]}
{"query":"available leave types","expected_doc_titles":["Employee Handbook"],"expected_terms":["leave","vacation","sick"]}`} />
              </FormField>
              <div className="span-two form-submit-row">
                <span className="muted" style={{ alignSelf: 'center' }}>
                  {queryCount > 0 ? `${queryCount} queries recognized` : queryCount === 0 ? 'No input yet' : 'Invalid JSON format'}
                </span>
                <button className="primary-button" type="submit" disabled={creating || queryCount <= 0}>Create dataset</button>
              </div>
            </form>
          </article>
          <article className="panel">
            <SectionHeader eyebrow="Evaluation" title="Datasets" />
            {datasets.length > 0 ? (
              <div className="mini-list">
                {datasets.map((ds) => (
                  <div key={ds.dataset_uuid} className="mini-list-item align-left">
                    <strong>{ds.name}</strong>
                    <small>{ds.description || 'No description'} · {formatDateTime(ds.created_at)}</small>
                    <div className="inline-actions">
                      <button className="secondary-button" onClick={() => handleViewDataset(ds.dataset_uuid)}>View</button>
                      <button className="danger-button" onClick={() => handleDeleteDataset(ds.dataset_uuid)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="muted">No evaluation datasets yet.</p>}
          </article>
        </section>
      ) : (
        <section className="grid two-up">
          <article className="panel">
            <SectionHeader eyebrow="Evaluation" title="Start Evaluation" />
            <form className="form-grid" onSubmit={handleCreateRun}>
              <FormField label="Dataset">
                <select value={runForm.dataset_uuid} onChange={(e) => setRunForm((c) => ({ ...c, dataset_uuid: e.target.value }))}>
                  <option value="">Select a dataset</option>
                  {datasets.map((ds) => (
                    <option key={ds.dataset_uuid} value={ds.dataset_uuid}>{ds.name} ({ds.query_count} queries)</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Chunking strategy">
                <select value={runForm.chunking_strategy} onChange={(e) => setRunForm((c) => ({ ...c, chunking_strategy: e.target.value }))}>
                  {chunkStrats.map((s) => <option key={s.name} value={s.name}>{getChunkingStrategyLabel(s.name)}</option>)}
                </select>
              </FormField>
              <FormField label="Retrieval strategy">
                <select value={runForm.retrieval_strategy} onChange={(e) => setRunForm((c) => ({ ...c, retrieval_strategy: e.target.value }))}>
                  {retrStrats.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
                </select>
              </FormField>
              {runForm.retrieval_strategy === 'hybrid' && (
                <FormField label="Fusion weight (alpha)">
                  <input type="range" min="0" max="1" step="0.1" value={runForm.fusion_alpha} onChange={(e) => setRunForm((c) => ({ ...c, fusion_alpha: Number(e.target.value) }))} />
                  <span style={{ fontSize: 12, color: '#76624f' }}>{runForm.fusion_alpha}</span>
                </FormField>
              )}
              <div className="span-two form-submit-row">
                <button className="primary-button" type="submit" disabled={running}>{running ? 'Running...' : 'Run evaluation'}</button>
              </div>
            </form>
          </article>
          <article className="panel">
            <SectionHeader eyebrow="Evaluation" title="Run History" />
            <FormField label="Filter by dataset">
              <input type="text" value={runDatasetUuid} onChange={(e) => { setRunDatasetUuid(e.target.value); refreshRuns(e.target.value || undefined) }} placeholder="Enter dataset_uuid..." />
            </FormField>
            {runs.length > 0 ? (
              <div className="mini-list">
                {runs.map((run) => (
                  <div key={run.run_uuid} className="mini-list-item align-left">
                    <strong>
                      <span className={`status-chip status-chip-${run.status === 'completed' ? 'success' : run.status === 'running' ? 'loading' : run.status === 'failed' ? 'danger' : 'neutral'}`}>{getStatusLabel(run.status)}</span>
                      &nbsp;{getChunkingStrategyLabel(run.chunking_strategy)} + {getRetrievalStrategyLabel(run.retrieval_strategy)}
                    </strong>
                    <small>{run.dataset_name || run.run_uuid.slice(0, 8)} · {run.summary ? `Hit@1: ${(run.summary.hit_at_1_rate * 100).toFixed(0)}%` : ''}</small>
                    <div className="inline-actions">
                      <button className="secondary-button" onClick={() => handleViewRun(run.run_uuid)}>Details</button>
                      <button className="danger-button" onClick={() => handleDeleteRun(run.run_uuid)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="muted">No evaluation runs yet.</p>}
          </article>
        </section>
      )}

      {selectedDataset ? (
        <section className="panel">
          <SectionHeader eyebrow="Details" title={`Dataset: ${selectedDataset.name}`} />
          <p className="muted">{selectedDataset.description}</p>
          <div className="mini-list">
            {selectedDataset.queries.map((q) => (
              <div key={q.query_uuid} className="mini-list-item align-left">
                <strong>{q.query_text}</strong>
                <small>Documents: {q.expected_doc_titles.join(', ') || 'None'}</small>
                <small>Keywords: {q.expected_terms.join(', ') || 'None'}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {selectedRun?.results ? (
        <section className="panel">
          <SectionHeader eyebrow="Results" title={`Evaluation run: ${selectedRun.run_uuid.slice(0, 8)}`} stateLabel={selectedRun.status} stateClass={`badge-${selectedRun.status === 'completed' ? 'ready' : 'loading'}`} />
          {selectedRun.summary ? (
            <div className="debug-overview-grid">
              <div className="summary-stat compact-stat"><strong>{(selectedRun.summary.hit_at_1_rate * 100).toFixed(0)}%</strong><span>Hit@1</span></div>
              <div className="summary-stat compact-stat"><strong>{(selectedRun.summary.hit_at_3_rate * 100).toFixed(0)}%</strong><span>Hit@3</span></div>
              <div className="summary-stat compact-stat"><strong>{(selectedRun.summary.hit_at_5_rate * 100).toFixed(0)}%</strong><span>Hit@5</span></div>
              <div className="summary-stat compact-stat"><strong>{selectedRun.summary.mean_mrr.toFixed(3)}</strong><span>Mean reciprocal rank</span></div>
              <div className="summary-stat compact-stat"><strong>{(selectedRun.summary.mean_term_hit_rate * 100).toFixed(0)}%</strong><span>Keyword hit rate</span></div>
              <div className="summary-stat compact-stat"><strong>{selectedRun.summary.mean_latency_ms}ms</strong><span>Mean latency</span></div>
            </div>
          ) : null}
          <div className="mini-list">
            {selectedRun.results.map((r) => (
              <div key={r.query_uuid} className="mini-list-item align-left">
                <strong>{r.query_text}</strong>
                <small>
                  Hit@1:{r.hit_at_1 ? '✅' : '❌'} @3:{r.hit_at_3 ? '✅' : '❌'} @5:{r.hit_at_5 ? '✅' : '❌'} ·
                  MRR:{r.mrr.toFixed(2)} · Keyword hit rate:{(r.expected_term_hit_rate * 100).toFixed(0)}% · {r.avg_latency_ms}ms
                </small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}
