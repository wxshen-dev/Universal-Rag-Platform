import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { downloadDocumentFile, fetchChunkingStrategies, fetchDocuments, previewChunking, previewDocumentChunking } from '../api'
import { getChunkingStrategyLabel } from '../chunkingStrategyLabels'
import { FormField, SectionHeader } from '../components/shared'
import type { ChunkingPreviewSource, ChunkingStrategyInfo, ChunkPreviewResult, DocumentItem } from '../types'

type StrategyGuide = {
  label: string
  summary: string
  details: string
  recommendedFor: string
  tuningAdvice: string
}

type ParamGuide = {
  label: string
  shortHint: string
  helpText: string
}

type PreviewChunkItem = ChunkPreviewResult['chunks'][number]
type ParentChildPreviewGroup = {
  groupKey: string
  parentIndex: number
  parentUuid?: string | null
  parentTotal?: unknown
  chunks: PreviewChunkItem[]
}

const STRATEGY_GUIDES: Record<string, StrategyGuide> = {
  fixed: {
    label: 'Fixed Length',
    summary: 'Splits by a fixed character count. This simple strategy is useful for quickly validating indexing and retrieval.',
    details: 'Text is split sequentially at the configured maximum length, with overlap to preserve information near boundaries.',
    recommendedFor: 'Plain text, inconsistently formatted material, or an initial end-to-end chunking check.',
    tuningAdvice: 'Increase chunk size when results are fragmented; decrease it when chunks mix too much information.',
  },
  structural: {
    label: 'Structural',
    summary: 'Splits on natural headings, paragraphs, and line breaks before dividing oversized sections.',
    details: 'Preserves section and paragraph boundaries better than fixed-length chunking, making it suitable for policies, guides, and knowledge articles.',
    recommendedFor: 'Markdown, policies, manuals, FAQs, and other content with a clear hierarchy.',
    tuningAdvice: 'Start with defaults. Reduce the maximum length for imprecise long paragraphs, or increase overlap when context is lost.',
  },
  'table-aware': {
    label: 'Table-aware',
    summary: 'Recognizes tables and groups headers with data rows so tabular context stays intact.',
    details: 'Keeps each batch of rows associated with its headers and falls back to standard chunking for non-table text.',
    recommendedFor: 'CSV, Excel exports, configuration tables, directories, and rule matrices.',
    tuningAdvice: 'Reduce rows per chunk for more precise matches; increase them when table context is too fragmented.',
  },
  'parent-child': {
    label: 'Parent-child',
    summary: 'Creates large parent chunks for context and smaller child chunks for precise retrieval.',
    details: 'Useful when retrieval must be precise while answers still need broader context. Child chunks are searched; parent chunks provide background.',
    recommendedFor: 'Long policies, manuals, and process documents with detailed sections that require full surrounding context.',
    tuningAdvice: 'Larger parents preserve context and smaller children improve precision. A common range is 2,000–4,000 characters for parents and 500–800 for children.',
  },
  semantic: {
    label: 'Semantic',
    summary: 'Splits around semantic topic changes instead of relying only on length or line breaks.',
    details: 'Text is divided into sentences, then adjacent semantic similarity is used to find topic boundaries.',
    recommendedFor: 'Natural-language documents with uneven paragraphs or frequent topic changes, such as reports, summaries, and meeting notes.',
    tuningAdvice: 'Lower the similarity threshold or raise minimum sentences if chunks are too small; do the opposite when topics are mixed.',
  },
}

const PARAM_GUIDES: Record<string, ParamGuide> = {
  max_chars: {
    label: 'Maximum characters per chunk',
    shortHint: 'The maximum length of each chunk.',
    helpText: 'Larger chunks preserve context but can reduce precision; smaller chunks are more precise but may lose context. A common range is 800–1,500.',
  },
  overlap_chars: {
    label: 'Chunk overlap',
    shortHint: 'Preserves key information across boundaries.',
    helpText: 'More overlap reduces boundary loss but increases index duplication. A typical value is 10–20% of the main chunk size.',
  },
  table_rows_per_chunk: {
    label: 'Table rows per chunk',
    shortHint: 'Maximum data rows in each table chunk.',
    helpText: 'More rows preserve table context; fewer rows improve precision. Compact configuration tables often work well with 10–30 rows.',
  },
  parent_max_chars: {
    label: 'Maximum parent characters',
    shortHint: 'Parent chunks preserve broader context.',
    helpText: 'Parents are usually larger, commonly 2,000–4,000 characters. Too small loses context; too large becomes unfocused.',
  },
  child_max_chars: {
    label: 'Maximum child characters',
    shortHint: 'Child chunks provide precise retrieval matches.',
    helpText: 'Children should be much smaller than parents, commonly 500–800 characters. Too large reduces precision; too small fragments meaning.',
  },
  min_chunk_sentences: {
    label: 'Minimum sentences per chunk',
    shortHint: 'Prevents semantic chunks from becoming too small.',
    helpText: 'Higher values create coarser, more stable chunks. A common starting point is 3–5 sentences.',
  },
  max_chunk_sentences: {
    label: 'Maximum sentences per chunk',
    shortHint: 'Prevents semantic chunks from becoming too long.',
    helpText: 'Higher values allow more sentences; lower values keep topics focused. Start around 10–20 sentences.',
  },
  similarity_threshold: {
    label: 'Semantic breakpoint threshold',
    shortHint: 'Controls how readily dissimilar sentences are separated.',
    helpText: 'Higher values split topic changes more aggressively; lower values keep content together. Start around 0.4–0.6.',
  },
  merge_window: {
    label: 'Semantic window',
    shortHint: 'Number of sentences considered when detecting topic changes.',
    helpText: 'Larger windows are smoother and more stable; smaller windows are more sensitive. A value of 2–4 is usually enough.',
  },
}

function getStrategyGuide(name: string): StrategyGuide {
  return STRATEGY_GUIDES[name] ?? {
    label: getChunkingStrategyLabel(name),
    summary: 'No detailed description is available for this strategy.',
    details: 'Preview with the default parameters, then adjust them based on the chunk results.',
    recommendedFor: 'Use for an initial trial, then tune based on the output.',
    tuningAdvice: 'Check whether chunks are too fragmented, too long, or missing context.',
  }
}

function getParamGuide(key: string, minimum?: number, maximum?: number): ParamGuide {
  const guide = PARAM_GUIDES[key]
  if (guide) return guide
  return {
    label: key,
    shortHint: `Start with the default value. Allowed range: ${minimum ?? '—'}–${maximum ?? '—'}.`,
    helpText: 'Preview the result first, then tune based on fragmentation, excessive length, or missing context.',
  }
}

function metadataText(chunk: PreviewChunkItem, key: string) {
  const value = chunk.metadata_json[key]
  if (value == null || value === '') return ''
  return String(value)
}

function locationItems(chunk: PreviewChunkItem) {
  const items: Array<{ label: string; value: string }> = []
  if (chunk.page_no) items.push({ label: 'Page', value: String(chunk.page_no) })
  if (chunk.sheet_name) items.push({ label: 'Sheet', value: chunk.sheet_name })
  if (chunk.row_start || chunk.row_end) {
    items.push({ label: 'Rows', value: `${chunk.row_start ?? '—'}-${chunk.row_end ?? '—'}` })
  }
  const heading = metadataText(chunk, 'section_heading') || metadataText(chunk, 'parent_section_heading') || chunk.section_title || ''
  if (heading) items.push({ label: 'Heading', value: heading })
  return items
}

function explainItems(chunk: PreviewChunkItem) {
  const metadata = chunk.metadata_json
  const strategy = metadataText(chunk, 'chunking_strategy')
  const items: Array<{ label: string; value: string }> = []
  if (strategy === 'structural') {
    items.push({ label: 'Reason', value: metadataText(chunk, 'split_reason') || 'Structural boundary' })
    items.push({
      label: 'Section',
      value: `${metadata.structural_section_index ?? metadata.section_part ?? '—'} / ${metadata.structural_section_total ?? metadata.section_total ?? '—'}`,
    })
  } else if (strategy === 'parent-child') {
    items.push({ label: 'Parent', value: `${Number(metadata.parent_index ?? 0) + 1} / ${metadata.parent_total ?? '—'}` })
    items.push({ label: 'Child', value: `${Number(metadata.child_index ?? 0) + 1} / ${metadata.child_total ?? metadata.total_children_in_parent ?? '—'}` })
    items.push({ label: 'Parent reason', value: metadataText(chunk, 'parent_split_reason') || 'Structural grouping' })
  } else if (strategy === 'semantic') {
    items.push({ label: 'Semantic segment', value: `${metadata.semantic_segment_index ?? '—'} / ${metadata.semantic_segment_total ?? '—'}` })
    items.push({ label: 'Sentences', value: `${metadata.sentence_start ?? '—'}-${metadata.sentence_end ?? '—'}` })
    items.push({ label: 'Breakpoint', value: metadataText(chunk, 'semantic_split_reason') || 'Semantic boundary' })
    if (metadata.semantic_breakpoint_score != null) {
      items.push({ label: 'Similarity', value: String(metadata.semantic_breakpoint_score) })
    }
  } else if (strategy === 'table-aware') {
    items.push({ label: 'Table batch', value: `${metadata.table_batch ?? '—'} / ${metadata.table_batch_total ?? '—'}` })
    items.push({ label: 'Rendering', value: metadataText(chunk, 'table_render_mode') || 'plain' })
  } else {
    items.push({ label: 'Part', value: `${metadata.split_part ?? chunk.chunk_index + 1} / ${metadata.split_total ?? '—'}` })
  }
  return items.filter((item) => item.value && item.value !== '— / —')
}

function numericMetadata(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parentPreviewGroupKey(chunk: PreviewChunkItem) {
  return chunk.parent_chunk_uuid || `parent-index:${numericMetadata(chunk.metadata_json.parent_index)}`
}

function parentGroupLocation(group: ParentChildPreviewGroup) {
  const first = group.chunks[0]
  if (!first) return ''

  const items: string[] = []
  const pageStart = first.metadata_json.parent_page_start
  const pageEnd = first.metadata_json.parent_page_end
  if (pageStart && pageEnd) {
    items.push(`Pages ${pageStart === pageEnd ? pageStart : `${pageStart}-${pageEnd}`}`)
  } else if (first.page_no) {
    items.push(`Page ${first.page_no}`)
  }
  const heading = metadataText(first, 'parent_section_heading') || first.section_title || ''
  if (heading) items.push(`Heading ${heading}`)
  if (group.parentUuid) items.push(`UUID ${group.parentUuid.slice(0, 8)}`)
  return items.join(' · ')
}

function PreviewExplain({ chunk }: { chunk: PreviewChunkItem }) {
  const explain = explainItems(chunk)
  const locations = locationItems(chunk)
  return (
    <>
      {explain.length > 0 ? (
        <div className="preview-facts">
          {explain.map((item) => (
            <span key={`${item.label}-${item.value}`}><b>{item.label}</b>{item.value}</span>
          ))}
        </div>
      ) : null}
      {locations.length > 0 ? (
        <div className="preview-location-row">
          {locations.map((item) => (
            <span key={`${item.label}-${item.value}`}>{item.label}: {item.value}</span>
          ))}
        </div>
      ) : null}
      <details className="metadata-details">
        <summary>Metadata</summary>
        <div className="debug-meta-row">
          {Object.entries(chunk.metadata_json).map(([k, v]) => (
            <span key={k}>{k}: {String(v)}</span>
          ))}
        </div>
      </details>
    </>
  )
}

export function ChunkingPage() {
  const [strategies, setStrategies] = useState<ChunkingStrategyInfo[]>([])
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [selectedStrategy, setSelectedStrategy] = useState('fixed')
  const [params, setParams] = useState<Record<string, number>>({})
  const [paramInputs, setParamInputs] = useState<Record<string, string>>({})
  const [previewText, setPreviewText] = useState('')
  const [previewResult, setPreviewResult] = useState<ChunkPreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [docKeyword, setDocKeyword] = useState('')
  const [selectedDoc, setSelectedDoc] = useState<DocumentItem | null>(null)
  const [previewSource, setPreviewSource] = useState<ChunkingPreviewSource>('text')
  const [previewError, setPreviewError] = useState('')

  function buildDefaultParams(strategy?: ChunkingStrategyInfo) {
    const defaults: Record<string, number> = {}
    const inputDefaults: Record<string, string> = {}
    if (strategy?.params_schema?.properties) {
      for (const [key, prop] of Object.entries(strategy.params_schema.properties)) {
        defaults[key] = prop.default
        inputDefaults[key] = String(prop.default)
      }
    }
    return { defaults, inputDefaults }
  }

  function sanitizeNumericInput(rawValue: string, type: string) {
    if (rawValue === '') return ''
    if (type === 'number') {
      const normalized = rawValue.replace(/[^\d.]/g, '')
      const firstDot = normalized.indexOf('.')
      if (firstDot === -1) return normalized
      return `${normalized.slice(0, firstDot + 1)}${normalized.slice(firstDot + 1).replace(/\./g, '')}`
    }
    return rawValue.replace(/[^\d]/g, '')
  }

  useEffect(() => {
    fetchChunkingStrategies().then((data) => {
      setStrategies(data.strategies)
      if (data.strategies.length > 0) {
        const first = data.strategies[0]
        setSelectedStrategy(first.name)
        const { defaults, inputDefaults } = buildDefaultParams(first)
        setParams(defaults)
        setParamInputs(inputDefaults)
      }
    }).catch(() => {})
    fetchDocuments({ pageSize: 100 }).then((data) => setDocuments(data.items)).catch(() => {})
  }, [])

  function handleStrategyChange(name: string) {
    setSelectedStrategy(name)
    const strategy = strategies.find((s) => s.name === name)
    const { defaults, inputDefaults } = buildDefaultParams(strategy)
    setParams(defaults)
    setParamInputs(inputDefaults)
  }

  function handleParamInputChange(key: string, rawValue: string, type: string) {
    const nextValue = sanitizeNumericInput(rawValue, type)
    setParamInputs((current) => ({ ...current, [key]: nextValue }))
    if (nextValue === '') return
    const parsed = type === 'number' ? Number.parseFloat(nextValue) : Number.parseInt(nextValue, 10)
    if (!Number.isNaN(parsed)) {
      setParams((current) => ({ ...current, [key]: parsed }))
    }
  }

  function handleParamInputBlur(key: string, prop: { default: number; minimum?: number; maximum?: number; type: string }) {
    const rawValue = paramInputs[key]
    if (rawValue === '' || rawValue == null) {
      setParams((current) => ({ ...current, [key]: prop.default }))
      setParamInputs((current) => ({ ...current, [key]: String(prop.default) }))
      return
    }
    const parsed = prop.type === 'number' ? Number.parseFloat(rawValue) : Number.parseInt(rawValue, 10)
    if (Number.isNaN(parsed)) {
      setParams((current) => ({ ...current, [key]: prop.default }))
      setParamInputs((current) => ({ ...current, [key]: String(prop.default) }))
      return
    }

    const min = prop.minimum ?? parsed
    const max = prop.maximum ?? parsed
    const clamped = Math.min(Math.max(parsed, min), max)
    setParams((current) => ({ ...current, [key]: clamped }))
    setParamInputs((current) => ({ ...current, [key]: prop.type === 'number' ? String(clamped) : String(Math.trunc(clamped)) }))
  }

  async function handlePreview(event: FormEvent) {
    event.preventDefault()
    setPreviewError('')
    setPreviewing(true)
    try {
      let result: ChunkPreviewResult
      if (previewSource === 'document' && selectedDoc) {
        if (!selectedDoc.file_exists) {
          setPreviewResult(null)
          setPreviewError('The original file is missing, so file-based chunking cannot be previewed. Re-upload it or switch to manual text preview.')
          return
        }
        result = await previewDocumentChunking(selectedDoc.doc_uuid, { strategy: selectedStrategy, options: params })
      } else {
        if (!previewText.trim()) {
          setPreviewResult(null)
          return
        }
        result = await previewChunking({ strategy: selectedStrategy, text: previewText, options: params })
      }
      setPreviewResult(result)
    } catch (error) {
      setPreviewResult(null)
      setPreviewError(error instanceof Error ? error.message : 'Chunk preview failed')
    }
    finally { setPreviewing(false) }
  }

  function handleDocSelect(doc: DocumentItem) {
    setPreviewError('')
    if (!doc.file_exists) {
      setSelectedDoc(doc)
      setPreviewSource('document')
      setPreviewResult(null)
      setPreviewError('The original file is missing and cannot be downloaded or previewed. Please upload it again.')
      return
    }
    setSelectedDoc(doc)
    setPreviewSource('document')
    setPreviewResult(null)
  }

  function switchToTextPreview() {
    setPreviewSource('text')
    setSelectedDoc(null)
    setPreviewResult(null)
    setPreviewError('')
  }

  const currentStrategy = strategies.find((s) => s.name === selectedStrategy)
  const currentGuide = useMemo(() => getStrategyGuide(selectedStrategy), [selectedStrategy])
  const groupedParentChildPreview = useMemo(() => {
    if (!previewResult || previewResult.strategy !== 'parent-child') return []

    const groups = new Map<string, PreviewChunkItem[]>()
    previewResult.chunks.forEach((chunk) => {
      const groupKey = parentPreviewGroupKey(chunk)
      const current = groups.get(groupKey) ?? []
      current.push(chunk)
      groups.set(groupKey, current)
    })

    return Array.from(groups.entries())
      .map(([groupKey, chunks]) => {
        const sortedChunks = [...chunks].sort((a, b) => numericMetadata(a.metadata_json.child_index) - numericMetadata(b.metadata_json.child_index))
        const first = sortedChunks[0]
        return {
          groupKey,
          parentIndex: numericMetadata(first?.metadata_json.parent_index),
          parentUuid: first?.parent_chunk_uuid,
          parentTotal: first?.metadata_json.parent_total,
          chunks: sortedChunks,
        }
      })
      .sort((a, b) => a.parentIndex - b.parentIndex)
  }, [previewResult])

  const filteredDocs = documents.filter((d) =>
    !docKeyword || d.title.toLowerCase().includes(docKeyword.toLowerCase())
  )

  return (
    <>
      <section className="panel hero-panel compact-hero">
        <div className="hero-copy">
          <p className="eyebrow">Chunking</p>
          <h2>Chunking Configuration</h2>
          <p className="muted">Choose a strategy, tune its parameters, and preview the results.</p>
        </div>
      </section>

      <section className="grid two-up chunking-config-grid">
        <article className="panel">
          <SectionHeader eyebrow="Chunking" title="Strategy and Parameters" />
          <form className="form-grid" onSubmit={handlePreview}>
            <FormField
              label="Chunking strategy"
              hint="Choose a strategy, then review its description and tuning guidance below."
              helpText="Different strategies suit different documents. Structural or parent-child chunking is usually a good starting point for policies and manuals."
            >
              <select value={selectedStrategy} onChange={(e) => handleStrategyChange(e.target.value)}>
                {strategies.map((s) => (
                  <option key={s.name} value={s.name}>{getChunkingStrategyLabel(s.name)}</option>
                ))}
              </select>
            </FormField>
            <div className="span-two strategy-guide-card">
              <div className="strategy-guide-head">
                <div>
                  <p className="eyebrow">Strategy guide</p>
                  <h4>{currentGuide.label}</h4>
                </div>
                <span className="strategy-guide-badge">{selectedStrategy}</span>
              </div>
              <p className="strategy-guide-summary">{currentGuide.summary}</p>
              <dl className="definition-list strategy-guide-list">
                <div className="definition-row">
                  <dt>What it does</dt>
                  <dd>{currentGuide.details}</dd>
                </div>
                <div className="definition-row">
                  <dt>Best for</dt>
                  <dd>{currentGuide.recommendedFor}</dd>
                </div>
                <div className="definition-row">
                  <dt>Tuning advice</dt>
                  <dd>{currentGuide.tuningAdvice}</dd>
                </div>
              </dl>
            </div>
            {currentStrategy?.params_schema?.properties &&
              Object.entries(currentStrategy.params_schema.properties).map(([key, prop]) => (
                <FormField
                  key={key}
                  label={getParamGuide(key, prop.minimum, prop.maximum).label}
                  hint={`${getParamGuide(key, prop.minimum, prop.maximum).shortHint} Range: ${prop.minimum ?? '—'}–${prop.maximum ?? '—'}`}
                  helpText={getParamGuide(key, prop.minimum, prop.maximum).helpText}
                >
                  <input
                    type="number"
                    value={paramInputs[key] ?? String(prop.default)}
                    min={prop.minimum}
                    max={prop.maximum}
                    step={prop.type === 'number' ? 0.1 : 1}
                    onChange={(e) => handleParamInputChange(key, e.target.value, prop.type)}
                    onBlur={() => handleParamInputBlur(key, prop)}
                  />
                </FormField>
              ))}
            <FormField
              label={previewSource === 'document' ? 'Uploaded File Preview' : 'Text Preview'}
              spanTwo
              helpText={previewSource === 'document'
                ? 'The uploaded source file is parsed and chunked with the selected strategy and parameters. Excel, CSV, PDF, and other formats use their own parsers.'
                : 'This preview chunks the text entered below. Paste content manually or select a document on the right to preview its parsed source file. Very short text usually produces one chunk.'}
              hint={previewSource === 'document'
                ? `Current document: ${selectedDoc?.title ?? 'Not selected'}. The source file will be chunked with the strategy and parameters on the left.`
                : 'Enter or paste representative content to preview chunking. Text here is ignored when uploaded-file mode is active.'}
            >
              {previewSource === 'document' ? (
                <div className="definition-list">
                  <div className="definition-row">
                    <dt>File name</dt>
                    <dd>{selectedDoc?.title ?? 'No document selected'}</dd>
                  </div>
                  <div className="definition-row">
                    <dt>Source</dt>
                    <dd>{selectedDoc ? `${selectedDoc.source_module} · ${selectedDoc.source_type}` : '—'}</dd>
                  </div>
                  <div className="definition-row">
                    <dt>Preview method</dt>
                    <dd>Parse and chunk the source file</dd>
                  </div>
                </div>
              ) : (
                <textarea
                  className="text-area"
                  rows={5}
                  value={previewText}
                  onChange={(e) => {
                    setPreviewText(e.target.value)
                    if (previewSource !== 'text') switchToTextPreview()
                  }}
                />
              )}
            </FormField>
            <div className="span-two form-submit-row">
              {previewSource === 'document' && selectedDoc && selectedDoc.file_exists ? (
                <button className="secondary-button" type="button" onClick={() => downloadDocumentFile(selectedDoc.doc_uuid)}>Download source file</button>
              ) : null}
              {previewSource === 'document' ? (
                <button className="secondary-button" type="button" onClick={switchToTextPreview}>Switch to manual text</button>
              ) : null}
              <button className="primary-button" type="submit" disabled={previewing || (previewSource === 'text' && !previewText.trim()) || (previewSource === 'document' && !!selectedDoc && !selectedDoc.file_exists)}>
                {previewing ? 'Previewing...' : 'Preview chunks'}
              </button>
            </div>
          </form>
        </article>

        <article className="panel chunking-doc-panel">
          <SectionHeader eyebrow="Documents" title="Document List" />
          <FormField label="Search documents">
            <input type="text" value={docKeyword} onChange={(e) => setDocKeyword(e.target.value)} placeholder="Enter title keywords..." />
          </FormField>
          <div className="mini-list chunking-doc-list">
            {filteredDocs.slice(0, 20).map((doc) => (
              <button
                key={doc.doc_uuid}
                type="button"
                className={`mini-list-item chunking-doc-list-item align-left ${selectedDoc?.doc_uuid === doc.doc_uuid && previewSource === 'document' ? 'is-selected' : ''}`}
                onClick={() => handleDocSelect(doc)}
              >
                <strong>{doc.title || doc.doc_uuid.slice(0, 8)}</strong>
                <small>{doc.source_module} · {doc.source_type}</small>
                <small>
                  {!doc.file_exists
                    ? 'Source file missing; upload again'
                    : selectedDoc?.doc_uuid === doc.doc_uuid && previewSource === 'document'
                    ? 'Currently previewing the parsed source file'
                    : 'Click to preview the parsed source file'}
                </small>
              </button>
            ))}
            {filteredDocs.length === 0 && <p className="muted">No matching documents.</p>}
          </div>
        </article>
      </section>

      {previewError ? (
        <section className="panel">
          <p className="error-text">{previewError}</p>
        </section>
      ) : null}

      {previewResult ? (
        <section className="panel">
          <SectionHeader eyebrow="Preview" title={`${getStrategyGuide(previewResult.strategy).label} · ${previewResult.total_chunks} chunks`} />
          {previewResult.strategy === 'parent-child' ? (
            <div className="parent-preview-list">
              {groupedParentChildPreview.map((group) => (
                <article key={group.groupKey} className="parent-preview-card">
                  <div className="debug-hit-head">
                    <div>
                      <strong>Parent #{group.parentIndex + 1}</strong>
                      <p>
                        Contains {group.chunks.length} child chunks, shown in order below.
                        {parentGroupLocation(group) ? ` ${parentGroupLocation(group)}` : ''}
                      </p>
                    </div>
                    <span className="status-chip status-chip-neutral">parent: {group.parentIndex + 1} / {String(group.parentTotal ?? '—')}</span>
                  </div>
                  <div className="debug-hit-list">
                    {group.chunks.map((chunk) => (
                      <article key={chunk.chunk_index} className="debug-hit-card child-preview-card">
                        <div className="debug-hit-head">
                          <strong>Child #{chunk.chunk_index + 1}</strong>
                          <span className="status-chip status-chip-success">{chunk.char_count} characters</span>
                        </div>
                        <p className="debug-snippet">{chunk.chunk_text}</p>
                        {chunk.context_text ? (
                          <details className="context-details">
                            <summary>Parent context</summary>
                            <p className="debug-snippet">{chunk.context_text}</p>
                          </details>
                        ) : null}
                        <PreviewExplain chunk={chunk} />
                      </article>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="debug-hit-list">
              {previewResult.chunks.map((chunk) => (
                <article key={chunk.chunk_index} className="debug-hit-card">
                  <div className="debug-hit-head">
                    <strong>#{chunk.chunk_index + 1}</strong>
                    <span className="status-chip status-chip-success">{chunk.char_count} characters</span>
                  </div>
                  <p className="debug-snippet">{chunk.chunk_text}</p>
                  <PreviewExplain chunk={chunk} />
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </>
  )
}
