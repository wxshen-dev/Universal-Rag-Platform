import { useCallback, useEffect, useMemo, useState } from 'react'
import { getApiBaseUrl } from '../api'
import { SectionHeader } from '../components/shared'
import { loadFieldOptionsSystemConfig } from '../fieldOptions'
import type { FieldOption } from '../types'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

type ToastTone = 'success' | 'danger'
type ToastState = { id: number; tone: ToastTone; message: string } | null

export function ApiEndpointsPage() {
  const [modules, setModules] = useState<FieldOption[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [toast, setToast] = useState<ToastState>(null)

  useEffect(() => {
    const tid = window.setTimeout(() => {
      void (async () => {
        setLoadState('loading')
        try {
          const { config } = await loadFieldOptionsSystemConfig()
          const enabled = config.fields.source_module.filter((o) => o.enabled && o.value.trim())
          setModules(enabled)
          if (enabled.length > 0) {
            setSelected(new Set([enabled[0].value]))
          }
          setLoadState('ready')
        } catch (err) {
          setLoadState('error')
          showToast(err instanceof Error ? err.message : 'Failed to load knowledge bases', 'danger')
        }
      })()
    }, 0)
    return () => window.clearTimeout(tid)
  }, [])

  useEffect(() => {
    if (!toast) return
    const tid = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(tid)
  }, [toast])

  function showToast(message: string, tone: ToastTone) {
    setToast({ id: Date.now(), tone, message })
  }

  function toggleModule(value: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(modules.map((m) => m.value)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  const selectedArray = useMemo(() => [...selected].sort(), [selected])

  const baseUrl = getApiBaseUrl()

  // General-purpose HTTP query endpoint.
  const httpUrl = useMemo(() => {
    return `${baseUrl}/knowledge/query`
  }, [baseUrl])

  // Dify appends /retrieval automatically, so this is the base endpoint.
  const difyRetrievalUrl = useMemo(() => {
    return `${baseUrl}/dify`
  }, [baseUrl])

  const difyKnowledgeUrl = useMemo(() => {
    return `${baseUrl}/dify/knowledge`
  }, [baseUrl])

  const filtersJson = useMemo(() => {
    if (selectedArray.length === 0) return '{}'
    return JSON.stringify({ source_module: selectedArray }, null, 2)
  }, [selectedArray])

  const httpExampleBody = useMemo(() => {
    return JSON.stringify(
      {
        query: 'Your query',
        top_k: 8,
        response_mode: 'search',
        filters: selectedArray.length > 0 ? { source_module: selectedArray } : undefined,
      },
      null,
      2,
    )
  }, [selectedArray])

  const difyRetrievalExampleBody = useMemo(() => {
    return JSON.stringify(
      {
        knowledge_id: selectedArray.length > 0 ? selectedArray.join(',') : '<knowledge-base-code>',
        query: 'Your query',
        retrieval_setting: { top_k: 5, score_threshold: 0.2 },
      },
      null,
      2,
    )
  }, [selectedArray])

  const copyText = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text)
        showToast(`${label} copied`, 'success')
      } catch {
        showToast('Copy failed. Please select and copy the text manually.', 'danger')
      }
    },
    [],
  )

  return (
    <>
      <section className="panel hero-panel compact-hero">
        <div className="hero-copy">
          <p className="eyebrow">API Endpoints</p>
          <h2>Endpoint Generator</h2>
          <p className="muted">Select knowledge bases and generate endpoints ready for Dify or direct HTTP requests.</p>
        </div>
      </section>

      {toast ? (
        <div className="toast-stack">
          <div className={`toast toast-${toast.tone}`}>{toast.message}</div>
        </div>
      ) : null}

      {/* Knowledge-base selection */}
      <section className="panel">
        <SectionHeader
          eyebrow="Step one"
          title="Select Knowledge Bases"
          stateLabel={loadState === 'loading' ? 'Loading' : loadState === 'error' ? 'Failed' : 'Ready'}
          stateClass={`badge-${loadState === 'error' ? 'error' : loadState === 'ready' ? 'ready' : 'loading'}`}
        />
        <div className="module-selector">
          <div className="module-selector-actions">
            <button className="secondary-button compact-button" type="button" onClick={selectAll}>
              Select all
            </button>
            <button className="secondary-button compact-button" type="button" onClick={clearAll}>
              Clear
            </button>
            <span className="muted">{selectedArray.length} selected</span>
          </div>
          <div className="module-chips">
            {modules.map((mod) => {
              const active = selected.has(mod.value)
              return (
                <button
                  key={mod.value}
                  className={`chip ${active ? 'chip-active' : ''}`}
                  type="button"
                  onClick={() => toggleModule(mod.value)}
                >
                  {mod.label || mod.value}
                </button>
              )
            })}
            {modules.length === 0 && loadState === 'ready' && (
              <p className="muted">No knowledge bases are available. Add one in Settings first.</p>
            )}
          </div>
        </div>
      </section>

      {/* General HTTP query endpoint */}
      <section className="panel">
        <SectionHeader eyebrow="General API" title="HTTP Knowledge Query" />
        <div className="api-endpoint-block">
          <div className="api-endpoint-header">
            <code className="api-method">POST</code>
            <code className="api-url">{httpUrl}</code>
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={() => void copyText(httpUrl, 'Endpoint')}
            >
              Copy endpoint
            </button>
          </div>
          <p className="muted">Supports search (retrieval only) and qa (retrieval plus answer) modes with complete citation details.</p>
          <div className="api-example">
            <div className="api-example-head">
              <span>Request example</span>
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={() => void copyText(httpExampleBody, 'Request example')}
              >
                Copy
              </button>
            </div>
            <pre className="code-block">{httpExampleBody}</pre>
          </div>
          <div className="api-example">
            <div className="api-example-head">
              <span>Filter reference</span>
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={() => void copyText(filtersJson, 'filters')}
              >
                Copy
              </button>
            </div>
            <pre className="code-block">{`// Use filters to limit the search to selected knowledge bases.
// source_module: array of knowledge-base codes
${filtersJson}`}</pre>
          </div>
        </div>
      </section>

      {/* Dify external knowledge endpoint */}
      <section className="panel">
        <SectionHeader eyebrow="Dify Integration" title="Dify External Knowledge API" />
        <div className="api-endpoint-block">
          <div className="api-endpoint-header">
            <code className="api-method">POST</code>
            <code className="api-url">{difyRetrievalUrl}</code>
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={() => void copyText(difyRetrievalUrl, 'Dify external knowledge endpoint')}
            >
              Copy endpoint
            </button>
          </div>
          <p className="muted">
            Uses the official External Knowledge API format. In Dify, set the API endpoint to <code>{difyRetrievalUrl}</code> without /retrieval; Dify appends it automatically.
          </p>
          <div className="api-example">
            <div className="api-example-head">
              <span>Dify knowledge-base configuration</span>
            </div>
            <pre className="code-block">{`# Dify external knowledge configuration

# Use host.docker.internal to reach the host from a Dify container.
API endpoint: http://host.docker.internal:18080/api/v1/dify
API key: DIFY_APP_KEY from .env

# Multiple knowledge bases (recommended)
# Enter comma-separated source_module values as the knowledge base ID.
Knowledge base ID: oa,kf

# Single knowledge base
Knowledge base ID: oa

# Metadata filters (passed in the request)
metadata_condition:
  logical_operator: or
  conditions:
    - name: source_module
      comparison_operator: "="
      value: oa
    - name: source_module
      comparison_operator: "="
      value: kf`}</pre>
          </div>
          <div className="api-example">
            <div className="api-example-head">
              <span>Request example</span>
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={() => void copyText(difyRetrievalExampleBody, 'Dify request example')}
              >
                Copy
              </button>
            </div>
            <pre className="code-block">{difyRetrievalExampleBody}</pre>
          </div>
        </div>

        <div className="api-endpoint-block" style={{ marginTop: '1.5rem' }}>
          <div className="api-endpoint-header">
            <code className="api-method">POST</code>
            <code className="api-url">{difyKnowledgeUrl}</code>
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={() => void copyText(difyKnowledgeUrl, 'Dify knowledge endpoint')}
            >
              Copy endpoint
            </button>
          </div>
          <p className="muted">
            Format for Dify workflows and HTTP tool nodes. Bearer token authentication is also required.
          </p>
        </div>
      </section>

      {/* API reference */}
      <section className="panel">
        <SectionHeader eyebrow="Reference" title="API Parameters" />
        <div className="api-doc-section">
          <h4>General query endpoint <code>/api/v1/knowledge/query</code></h4>
          <table className="api-doc-table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Type</th>
                <th>Required</th>
                <th>Default</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>query</td><td>string</td><td>Yes</td><td>—</td><td>Query text</td></tr>
              <tr><td>top_k</td><td>int</td><td>No</td><td>8</td><td>Number of results, 1–50</td></tr>
              <tr><td>min_score</td><td>float</td><td>No</td><td>0.2</td><td>Minimum score threshold, 0–1</td></tr>
              <tr><td>response_mode</td><td>string</td><td>No</td><td>search</td><td>search (retrieval only) / qa (retrieval plus answer)</td></tr>
              <tr><td>filters.source_module</td><td>string[]</td><td>No</td><td>null</td><td>Filter by knowledge base</td></tr>
              <tr><td>filters.source_type</td><td>string[]</td><td>No</td><td>null</td><td>Filter by document type</td></tr>
              <tr><td>filters.file_ext</td><td>string[]</td><td>No</td><td>null</td><td>Filter by file extension</td></tr>
              <tr><td>generation_options.temperature</td><td>float</td><td>No</td><td>0.1</td><td>LLM temperature in qa mode</td></tr>
              <tr><td>generation_options.max_tokens</td><td>int</td><td>No</td><td>1200</td><td>Maximum LLM output tokens in qa mode</td></tr>
            </tbody>
          </table>

          <h4 style={{ marginTop: '1.5rem' }}>Response Fields</h4>
          <table className="api-doc-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>query</td><td>string</td><td>Original query</td></tr>
              <tr><td>mode</td><td>string</td><td>search / qa</td></tr>
              <tr><td>answer</td><td>string</td><td>Answer text; search mode returns a combined summary</td></tr>
              <tr><td>answer_status</td><td>string</td><td>grounded / insufficient_evidence</td></tr>
              <tr><td>references[]</td><td>array</td><td>Citations with doc_uuid, chunk_uuid, title, snippet, score, and more</td></tr>
              <tr><td>filters_applied</td><td>object</td><td>Filters actually applied</td></tr>
              <tr><td>latency_ms</td><td>object</td><td>Latency for retrieval, generation, and total</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
