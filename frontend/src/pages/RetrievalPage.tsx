import { useEffect, useState, type FormEvent } from 'react'
import { FormField, SectionHeader } from '../components/shared'
import { API_BASE, debugSearch, fetchRetrievalStrategies } from '../api'
import {
  DEFAULT_FIELD_OPTIONS_CONFIG,
  getFieldOptions,
  loadFieldOptionsSystemConfig,
} from '../fieldOptions'
import type { DebugSearchDataV2, FieldOptionsConfig, RetrievalStrategiesResponse } from '../types'

export function RetrievalPage() {
  const [debugData, setDebugData] = useState<DebugSearchDataV2 | null>(null)
  const [debugState, setDebugState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [stratInfo, setStratInfo] = useState<RetrievalStrategiesResponse | null>(null)
  const [fieldOptions, setFieldOptions] = useState<FieldOptionsConfig>(DEFAULT_FIELD_OPTIONS_CONFIG)
  const [debugForm, setDebugForm] = useState({
    query: '',
    strategy: 'dense',
    fusionAlpha: 0.7,
    sourceModule: '',
  })

  useEffect(() => {
    fetchRetrievalStrategies().then(setStratInfo).catch(() => {})
    loadFieldOptionsSystemConfig().then((data) => setFieldOptions(data.config)).catch(() => {})
  }, [])

  async function handleDebugSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDebugState('loading')
    try {
      const payload: Record<string, unknown> = {
        query: debugForm.query,
        top_k: 5,
        strategy: debugForm.strategy,
        filters: debugForm.sourceModule ? { source_module: [debugForm.sourceModule] } : undefined,
      }
      if (debugForm.strategy === 'hybrid') {
        payload.strategy_params = { fusion_alpha: debugForm.fusionAlpha }
      }
      const data = await debugSearch(payload as Parameters<typeof debugSearch>[0])
      setDebugData(data)
      setDebugState('ready')
    } catch { setDebugState('error') }
  }

  return (
    <>
      <section className="panel hero-panel compact-hero">
        <div className="hero-copy">
          <p className="eyebrow">Retrieval</p>
          <h2>Retrieval Testing</h2>
          <p className="muted">Choose a retrieval strategy, tune parameters, run a search, and inspect detailed scores.</p>
        </div>
        <div className="hero-actions">
          {stratInfo ? (
            <div className="summary-stat">
              <strong>{stratInfo.strategies.length}</strong>
              <span>Available strategies</span>
            </div>
          ) : null}
          {stratInfo?.rerank?.enabled ? (
            <div className="summary-stat">
              <strong>Rerank</strong>
              <span>{stratInfo.rerank.model ?? 'Enabled'}</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <SectionHeader eyebrow="Retrieval" title="Debug Search" stateLabel={debugState === 'loading' ? 'Searching' : debugState === 'ready' ? 'Complete' : debugState === 'error' ? 'Failed' : 'Ready'} stateClass={`badge-${debugState === 'ready' ? 'ready' : debugState === 'error' ? 'error' : 'loading'}`} />
        <form className="form-grid debug-form" onSubmit={handleDebugSearch}>
          <FormField label="Retrieval strategy">
            <select value={debugForm.strategy} onChange={(e) => setDebugForm((c) => ({ ...c, strategy: e.target.value }))}>
              {stratInfo?.strategies.map((s) => (
                <option key={s.name} value={s.name}>{s.label}</option>
              )) ?? (
                <>
                  <option value="dense">Dense retrieval</option>
                  <option value="hybrid">Hybrid retrieval</option>
                </>
              )}
            </select>
          </FormField>
          {debugForm.strategy === 'hybrid' && (
            <FormField label="Fusion weight (alpha)" hint="Vector weight from 0 to 1; higher values favor semantic similarity.">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={debugForm.fusionAlpha}
                onChange={(e) => setDebugForm((c) => ({ ...c, fusionAlpha: Number(e.target.value) }))}
              />
              <span style={{ fontSize: 12, color: '#76624f' }}>{debugForm.fusionAlpha}</span>
            </FormField>
          )}
          <div className="span-two strategy-guide-card">
            <div className="strategy-guide-head">
              <div>
                <p className="eyebrow">Score guide</p>
                <h4>{debugForm.strategy === 'hybrid' ? 'Hybrid retrieval scoring' : 'Dense retrieval scoring'}</h4>
              </div>
            </div>
            {debugForm.strategy === 'hybrid' ? (
              <dl className="definition-list strategy-guide-list">
                <div className="definition-row">
                  <dt>Vector score</dt>
                  <dd>The raw dense-retrieval score. It represents semantic similarity, not the final ranking score.</dd>
                </div>
                <div className="definition-row">
                  <dt>Sparse score</dt>
                  <dd>The raw BM25 keyword score. A null value means the item was not returned by sparse retrieval.</dd>
                </div>
                <div className="definition-row">
                  <dt>Final score</dt>
                  <dd>Not a simple average. Dense and sparse scores are normalized separately, then fused as alpha × dense_norm + (1 - alpha) × sparse_norm.</dd>
                </div>
              </dl>
            ) : (
              <dl className="definition-list strategy-guide-list">
                <div className="definition-row">
                  <dt>Vector score</dt>
                  <dd>The dense-retrieval semantic similarity score and final ranking score.</dd>
                </div>
              </dl>
            )}
          </div>
          <FormField label="Query" hint="Enter the question or keywords you want to test.">
            <input type="text" value={debugForm.query} onChange={(e) => setDebugForm((c) => ({ ...c, query: e.target.value }))} />
          </FormField>
          <FormField label="Knowledge base" hint="Optional.">
            <select value={debugForm.sourceModule} onChange={(e) => setDebugForm((c) => ({ ...c, sourceModule: e.target.value }))}>
              <option value="">All modules</option>
              {getFieldOptions(fieldOptions, 'source_module', debugForm.sourceModule).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FormField>
          <div className="span-two form-submit-row">
            <button className="primary-button" type="submit">Run debug search</button>
          </div>
        </form>

        {debugData ? (
          <div className="debug-result-area">
            <div className="debug-overview-grid">
              <div className="summary-stat compact-stat"><strong>{debugData.hits.length}</strong><span>Hits</span></div>
              <div className="summary-stat compact-stat"><strong>{debugData.latency_ms}ms</strong><span>API latency</span></div>
              <div className="summary-stat compact-stat"><strong>{debugData.query}</strong><span>Original query</span></div>
              <div className="summary-stat compact-stat"><strong>{debugData.rewritten_query}</strong><span>Rewritten query</span></div>
              {debugData.retrieval_strategy && (
                <div className="summary-stat compact-stat"><strong>{debugData.retrieval_strategy}</strong><span>Retrieval strategy</span></div>
              )}
              {debugData.rerank_enabled && (
                <div className="summary-stat compact-stat"><strong>{debugData.rerank_latency_ms}ms</strong><span>Rerank latency</span></div>
              )}
            </div>
            {debugData.hits.length > 0 ? (
              <div className="debug-hit-list">
                {debugData.hits.map((hit) => (
                  <article key={hit.chunk_uuid} className="debug-hit-card">
                    <div className="debug-hit-head">
                      <div>
                        <strong>{hit.title}</strong>
                        <p className="muted">Document: {hit.doc_uuid} · Chunk: {hit.chunk_uuid}</p>
                      </div>
                      <span className="status-chip status-chip-success">score {hit.score.toFixed(3)}</span>
                    </div>
                    <div className="debug-meta-row">
                      <span>Module: {hit.source_module}</span>
                      <span>Version: {hit.version}</span>
                      <span>Raw vector score: {hit.vector_score?.toFixed(3) ?? '—'}</span>
                      {'sparse_score' in hit && <span>Raw sparse score: {(hit as { sparse_score?: number }).sparse_score?.toFixed(3) ?? '—'}</span>}
                      {'rerank_score' in hit && (hit as { rerank_score?: number }).rerank_score != null && <span>Rerank: {(hit as { rerank_score: number }).rerank_score.toFixed(3)}</span>}
                    </div>
                    <p className="debug-snippet">{hit.snippet}</p>
                    {hit.image_url && (
                      <div className="debug-hit-image">
                        <img src={`${API_BASE.replace('/api/v1', '')}${hit.image_url}`} alt={hit.title} />
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
               <div className="empty-debug-state"><strong>This search returned no hits</strong><p>Try broadening the knowledge-base filter, checking user permissions, or using a more specific query.</p></div>
            )}
            <details className="debug-raw-box">
              <summary>View ranking details</summary>
              <pre>{JSON.stringify(debugData.ranking_debug, null, 2)}</pre>
            </details>
            {(debugData.dense_hits?.length || debugData.sparse_hits?.length) ? (
              <details className="debug-raw-box">
                <summary>View retrieval-source details</summary>
                <pre>{JSON.stringify({ dense_hits: debugData.dense_hits, sparse_hits: debugData.sparse_hits }, null, 2)}</pre>
              </details>
            ) : null}
          </div>
        ) : (
          <div className="empty-debug-state"><strong>Results will appear here</strong><p>You will see hit counts, latency, result cards, and ranking diagnostics.</p></div>
        )}
      </section>
    </>
  )
}
