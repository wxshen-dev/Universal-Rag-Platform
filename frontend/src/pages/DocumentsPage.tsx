import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  API_BASE,
  batchDelete,
  batchReindex,
  downloadDocumentFile,
  fetchChunkingStrategies,
  fetchConfigs,
  fetchDocumentDetail,
  fetchDocuments,
  fetchHealth,
  fetchJobs,
  updateDocument,
  uploadDocument,
} from '../api'
import { getChunkingStrategyLabel } from '../chunkingStrategyLabels'
import { FormField, SectionHeader } from '../components/shared'
import {
  DEFAULT_FIELD_OPTIONS_CONFIG,
  firstEnabledValue,
  getFieldLabel,
  getFieldOptions,
  loadFieldOptionsSystemConfig,
} from '../fieldOptions'
import { formatDateTime, getHealthTone, getJobTone, getLoadStateLabel, stringifyValue } from '../utils'
import type {
  ChunkingStrategyInfo,
  ConfigData,
  DocumentDetail,
  DocumentItem,
  FieldKey,
  FieldOptionsConfig,
  HealthData,
  JobItem,
} from '../types'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type ToastTone = 'info' | 'success' | 'danger'

type ToastState = {
  id: number
  tone: ToastTone
  message: string
}

type DocumentQueryState = {
  keyword: string
  sourceModule: string
  sourceType: string
  parseStatus: string
  indexStatus: string
  page: number
  pageSize: number
}

type JobQueryState = {
  status: string
  page: number
  pageSize: number
}

type UploadFormState = {
  title: string
  source_type: string
  source_module: string
  tags: string[]
  chunkingStrategy: string
}

type DocumentEditFormState = {
  title: string
  source_module: string
  source_type: string
  tags: string[]
  chunkingStrategy: string
}

const DEFAULT_DOCUMENT_QUERY: DocumentQueryState = {
  keyword: '',
  sourceModule: '',
  sourceType: '',
  parseStatus: '',
  indexStatus: '',
  page: 1,
  pageSize: 10,
}

const DEFAULT_JOB_QUERY: JobQueryState = {
  status: '',
  page: 1,
  pageSize: 8,
}

const HEALTH_LABELS: Record<string, string> = {
  app: 'Application',
  postgres: 'PostgreSQL',
  redis: 'Redis',
  zilliz: 'Zilliz',
  embedding: 'Embedding model',
  llm_provider: 'LLM provider',
  provider_fallbacks_enabled: 'Provider fallbacks',
  ingestion_mode: 'Ingestion mode',
  probes: 'External probes',
}

const JOB_TYPE_LABELS: Record<string, string> = {
  ingest: 'Document ingestion',
  reindex: 'Reindex',
}

const JOB_STATUS_LABELS: Record<string, string> = {
  pending: 'Queued',
  running: 'Processing',
  success: 'Completed',
  failed: 'Failed',
}

const JOB_STEP_LABELS: Record<string, string> = {
  queued: 'Queued',
  created: 'Created',
  parsing: 'Parsing',
  chunking: 'Chunking',
  vector_upsert: 'Writing index',
  indexed: 'Indexed',
  chunking_completed: 'Chunking complete',
  failed: 'Processing failed',
}

const DEFAULT_UPLOAD_FIELDS: UploadFormState = {
  title: '',
  source_type: 'rule_doc',
  source_module: 'oa',
  tags: [],
  chunkingStrategy: 'fixed',
}

const EMPTY_DOCUMENT_EDIT_FORM: DocumentEditFormState = {
  title: '',
  source_module: '',
  source_type: 'rule_doc',
  tags: [],
  chunkingStrategy: 'fixed',
}

function getJobTypeLabel(value: string) {
  return JOB_TYPE_LABELS[value] ?? value
}

function getJobStatusLabel(value: string) {
  return JOB_STATUS_LABELS[value] ?? value
}

function getJobStepLabel(value: string) {
  return JOB_STEP_LABELS[value] ?? value
}

function normalizeTags(tags: string[]) {
  return Array.from(new Set(tags.map((item) => item.trim()).filter(Boolean)))
}

function isImageFile(file: File | null): boolean {
  if (!file) return false
  return file.type.startsWith('image/')
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'webp'])

function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase())
}

function buildExtraMeta(chunkingStrategy: string, previousExtraMeta?: Record<string, unknown>) {
  const nextMeta = { ...(previousExtraMeta ?? {}) }
  nextMeta.chunking_strategy = chunkingStrategy || 'fixed'
  return nextMeta
}

function ensureEnabledFieldValue(config: FieldOptionsConfig, fieldKey: FieldKey, value: string, fallback: string) {
  if (getFieldOptions(config, fieldKey).some((option) => option.value === value)) return value
  return firstEnabledValue(config, fieldKey, fallback)
}

export function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [documentsTotal, setDocumentsTotal] = useState(0)
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [jobsTotal, setJobsTotal] = useState(0)
  const [health, setHealth] = useState<HealthData | null>(null)
  const [configs, setConfigs] = useState<ConfigData | null>(null)
  const [fieldOptions, setFieldOptions] = useState<FieldOptionsConfig>(DEFAULT_FIELD_OPTIONS_CONFIG)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null)
  const [coreState, setCoreState] = useState<LoadState>('idle')
  const [healthState, setHealthState] = useState<LoadState>('idle')
  const [, setStatusMessage] = useState('Console ready')
  const [toast, setToast] = useState<ToastState | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [savingDoc, setSavingDoc] = useState(false)
  const [uploadInputKey, setUploadInputKey] = useState(0)
  const [healthCollapsed, setHealthCollapsed] = useState(true)
  const [chunkingStrategies, setChunkingStrategies] = useState<ChunkingStrategyInfo[]>([])
  const [tagInputValue, setTagInputValue] = useState('')
  const [editTagInputValue, setEditTagInputValue] = useState('')
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [openMoreMenuDocUuid, setOpenMoreMenuDocUuid] = useState<string | null>(null)

  const [documentFilters, setDocumentFilters] = useState(DEFAULT_DOCUMENT_QUERY)
  const [documentQuery, setDocumentQuery] = useState(DEFAULT_DOCUMENT_QUERY)
  const [jobFilters, setJobFilters] = useState(DEFAULT_JOB_QUERY)
  const [jobQuery, setJobQuery] = useState(DEFAULT_JOB_QUERY)

  const [uploadFields, setUploadFields] = useState<UploadFormState>(DEFAULT_UPLOAD_FIELDS)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false)

  const [documentEditForm, setDocumentEditForm] = useState<DocumentEditFormState>(EMPTY_DOCUMENT_EDIT_FORM)

  const selectedSummary = useMemo(() => {
    if (selectedIds.length === 0) return 'No documents selected'
    return `${selectedIds.length} documents selected`
  }, [selectedIds])

  const allVisibleSelected = useMemo(() => {
    if (documents.length === 0) return false
    return documents.every((document) => selectedIds.includes(document.doc_uuid))
  }, [documents, selectedIds])

  const documentPageCount = Math.max(1, Math.ceil(documentsTotal / documentQuery.pageSize))
  const jobPageCount = Math.max(1, Math.ceil(jobsTotal / jobQuery.pageSize))
  const isAsyncMode = configs?.ingestion_mode === 'async'
  const sourceModuleOptions = useMemo(() => getFieldOptions(fieldOptions, 'source_module'), [fieldOptions])
  const sourceTypeOptions = useMemo(() => getFieldOptions(fieldOptions, 'source_type'), [fieldOptions])



  const tagSuggestions = useMemo(() => {
    const values = new Set<string>()
    documents.forEach((doc) => {
      if ('tags' in doc && Array.isArray((doc as DocumentDetail).tags)) {
        ;((doc as DocumentDetail).tags ?? []).forEach((tag) => values.add(String(tag).trim()))
      }
    })
    if (selectedDoc?.tags) selectedDoc.tags.forEach((tag) => values.add(String(tag).trim()))
    return Array.from(values).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [documents, selectedDoc])

  const uploadTagSuggestions = useMemo(() => {
    const keyword = tagInputValue.trim().toLowerCase()
    return tagSuggestions.filter((tag) => !uploadFields.tags.includes(tag) && (!keyword || tag.toLowerCase().includes(keyword))).slice(0, 8)
  }, [tagInputValue, tagSuggestions, uploadFields.tags])

  const editTagSuggestions = useMemo(() => {
    const keyword = editTagInputValue.trim().toLowerCase()
    return tagSuggestions.filter((tag) => !documentEditForm.tags.includes(tag) && (!keyword || tag.toLowerCase().includes(keyword))).slice(0, 8)
  }, [documentEditForm.tags, editTagInputValue, tagSuggestions])

  useEffect(() => {
    if (!toast) return
    const timeoutId = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timeoutId)
  }, [toast])

  const showToast = useCallback((message: string, tone: ToastTone) => {
    setToast({ id: Date.now(), tone, message })
  }, [])

  const showError = useCallback((message: string) => {
    setStatusMessage(message)
    showToast(message, 'danger')
  }, [showToast])

  const showSuccess = useCallback((message: string) => {
    setStatusMessage(message)
    showToast(message, 'success')
  }, [showToast])

  const refreshCoreData = useCallback(async () => {
    setCoreState('loading')
    const [documentsData, jobsData] = await Promise.all([
      fetchDocuments({
        page: documentQuery.page, pageSize: documentQuery.pageSize,
        keyword: documentQuery.keyword, sourceModule: documentQuery.sourceModule,
        sourceType: documentQuery.sourceType, parseStatus: documentQuery.parseStatus,
        indexStatus: documentQuery.indexStatus,
      }),
      fetchJobs({ page: jobQuery.page, pageSize: jobQuery.pageSize, status: jobQuery.status }),
    ])
    setDocuments(documentsData.items)
    setDocumentsTotal(documentsData.total)
    setJobs(jobsData.items)
    setJobsTotal(jobsData.total)
    setCoreState('ready')
    setSelectedIds((current) =>
      current.filter((docUuid) => documentsData.items.some((item) => item.doc_uuid === docUuid)),
    )
    if (selectedDocId && !documentsData.items.some((item) => item.doc_uuid === selectedDocId)) {
      setSelectedDocId(null)
      setSelectedDoc(null)
    }
    return { documentCount: documentsData.total, jobCount: jobsData.total }
  }, [documentQuery, jobQuery, selectedDocId])

  async function refreshHealthData() {
    setHealthState('loading')
    const result = await fetchHealth()
    setHealth(result)
    setHealthState('ready')
  }

  async function refreshConfigData() {
    const configsData = await fetchConfigs()
    setConfigs(configsData)
  }

  async function refreshFieldOptionsData() {
    const data = await loadFieldOptionsSystemConfig()
    setFieldOptions(data.config)
    setUploadFields((current) => ({
      ...current,
      source_module: ensureEnabledFieldValue(data.config, 'source_module', current.source_module, 'oa'),
      source_type: ensureEnabledFieldValue(data.config, 'source_type', current.source_type, 'rule_doc'),
    }))
  }

  async function refreshChunkingStrategies() {
    const data = await fetchChunkingStrategies()
    setChunkingStrategies(data.strategies)
    setUploadFields((current) => {
      if (data.strategies.some((item) => item.name === current.chunkingStrategy)) return current
      return { ...current, chunkingStrategy: data.strategies[0]?.name ?? 'fixed' }
    })
    setDocumentEditForm((current) => {
      if (data.strategies.some((item) => item.name === current.chunkingStrategy)) return current
      return { ...current, chunkingStrategy: data.strategies[0]?.name ?? 'fixed' }
    })
  }

  async function refreshDashboard() {
    const results = await Promise.allSettled([refreshCoreData(), refreshHealthData(), refreshConfigData(), refreshChunkingStrategies(), refreshFieldOptionsData()])
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length > 0) {
      if (results[0]?.status === 'rejected') setCoreState('error')
      if (results[1]?.status === 'rejected') setHealthState('error')
      const reason = failures[0]?.reason
      showError(reason instanceof Error ? reason.message : 'Some data failed to load')
    } else {
      const coreResult = results[0]
      if (coreResult.status === 'fulfilled') {
        setStatusMessage(`Loaded ${coreResult.value.documentCount} documents and ${coreResult.value.jobCount} jobs`)
      }
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const results = await Promise.allSettled([
          refreshCoreData(),
          refreshHealthData(),
          refreshConfigData(),
          refreshChunkingStrategies(),
          refreshFieldOptionsData(),
        ])
        const failures = results.filter((result) => result.status === 'rejected')
        if (failures.length > 0) {
          if (results[0]?.status === 'rejected') setCoreState('error')
          if (results[1]?.status === 'rejected') setHealthState('error')
          const reason = failures[0]?.reason
          showError(reason instanceof Error ? reason.message : 'Some data failed to load')
        } else {
          const coreResult = results[0]
          if (coreResult.status === 'fulfilled') {
            setStatusMessage(`Loaded ${coreResult.value.documentCount} documents and ${coreResult.value.jobCount} jobs`)
          }
        }
      })()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [documentQuery, jobQuery, refreshCoreData, showError])

  function toggleSelected(docUuid: string) {
    setSelectedIds((current) =>
      current.includes(docUuid) ? current.filter((item) => item !== docUuid) : [...current, docUuid],
    )
  }

  function toggleVisibleSelection() {
    const visibleIds = documents.map((document) => document.doc_uuid)
    setSelectedIds((current) => {
      if (visibleIds.every((docUuid) => current.includes(docUuid))) {
        return current.filter((docUuid) => !visibleIds.includes(docUuid))
      }
      return Array.from(new Set([...current, ...visibleIds]))
    })
  }

  function applyDocumentFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDocumentQuery({ ...documentFilters, page: 1 })
  }

  function resetDocumentFilters() {
    setDocumentFilters(DEFAULT_DOCUMENT_QUERY)
    setDocumentQuery(DEFAULT_DOCUMENT_QUERY)
  }

  function applyJobFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setJobQuery({ ...jobFilters, page: 1 })
  }

  function resetJobFilters() {
    setJobFilters(DEFAULT_JOB_QUERY)
    setJobQuery(DEFAULT_JOB_QUERY)
  }

  async function openDocumentDetail(docId: string) {
    try {
      const data = await fetchDocumentDetail(docId)
      setSelectedDocId(docId)
      setSelectedDoc(data)
      setDocumentEditForm({
        title: data.title,
        source_module: data.source_module,
        source_type: data.source_type,
        tags: normalizeTags((data.tags ?? []).map((tag) => String(tag))),
        chunkingStrategy: typeof data.extra_meta?.chunking_strategy === 'string' ? data.extra_meta.chunking_strategy : 'fixed',
      })
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to load document details')
    }
  }

  async function handleBatchDelete(ids?: string[]) {
    const targets = ids ?? selectedIds
    if (targets.length === 0) { showError('Select documents to delete first'); return }
    if (!window.confirm(`Delete the ${targets.length} selected documents? This action cannot be undone.`)) return
    try {
      const result = await batchDelete(targets)
      setSelectedIds([])
      if (selectedDocId && targets.includes(selectedDocId)) setSelectedDocId(null)
      await refreshDashboard()
      showSuccess(`Bulk delete complete: ${result.success_count} of ${result.total} succeeded`)
    } catch (error) { showError(error instanceof Error ? error.message : 'Bulk delete failed') }
  }

  async function handleBatchReindex(ids?: string[]) {
    const targets = ids ?? selectedIds
    if (targets.length === 0) { showError('Select documents to reindex first'); return }
    if (!window.confirm(`Rebuild the index for the ${targets.length} selected documents?`)) return
    try {
      const result = await batchReindex(targets)
      await refreshDashboard()
      showSuccess(`Bulk reindex complete: ${result.success_count} of ${result.total} succeeded`)
    } catch (error) { showError(error instanceof Error ? error.message : 'Bulk reindex failed') }
  }

  function addUploadTag(tag: string) {
    const normalized = tag.trim()
    if (!normalized) return
    setUploadFields((current) => ({ ...current, tags: normalizeTags([...current.tags, normalized]) }))
    setTagInputValue('')
  }

  function removeUploadTag(tag: string) {
    setUploadFields((current) => ({ ...current, tags: current.tags.filter((item) => item !== tag) }))
  }

  function addEditTag(tag: string) {
    const normalized = tag.trim()
    if (!normalized) return
    setDocumentEditForm((current) => ({ ...current, tags: normalizeTags([...current.tags, normalized]) }))
    setEditTagInputValue('')
  }

  function removeEditTag(tag: string) {
    setDocumentEditForm((current) => ({ ...current, tags: current.tags.filter((item) => item !== tag) }))
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!uploadFile) { showError('Select a file to upload first'); return }
    if (!uploadFields.source_type.trim() || !uploadFields.source_module.trim()) {
      showError('Document type and knowledge base are required'); return
    }

    const formData = new FormData()
    formData.append('file', uploadFile)
    formData.append('title', uploadFields.title)
    formData.append('source_type', uploadFields.source_type)
    formData.append('source_module', uploadFields.source_module)
    formData.append('tags', JSON.stringify(normalizeTags(uploadFields.tags)))
    formData.append('extra_meta', JSON.stringify(buildExtraMeta(uploadFields.chunkingStrategy)))
    try {
      setUploading(true)
      setStatusMessage(`Uploading ${uploadFile.name}...`)
      const result = await uploadDocument(formData)
      setUploadFile(null)
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl)
        setImagePreviewUrl(null)
      }
      setUploadFields((current) => ({
        ...DEFAULT_UPLOAD_FIELDS,
        source_module: firstEnabledValue(fieldOptions, 'source_module', DEFAULT_UPLOAD_FIELDS.source_module),
        source_type: firstEnabledValue(fieldOptions, 'source_type', DEFAULT_UPLOAD_FIELDS.source_type),
        chunkingStrategy: current.chunkingStrategy,
      }))
      setTagInputValue('')
      setUploadInputKey((current) => current + 1)
      await refreshDashboard()
      setSelectedDocId(result.doc_uuid)
      showSuccess(`Upload successful. Job ID: ${result.job_uuid}`)
    } catch (error) { showError(error instanceof Error ? error.message : 'Upload failed') }
    finally { setUploading(false) }
  }

  async function startEditDocument(docId: string) {
    setEditDialogOpen(true)
    setEditTagInputValue('')
    try {
      const data = selectedDocId === docId && selectedDoc ? selectedDoc : await fetchDocumentDetail(docId)
      setSelectedDocId(docId)
      setSelectedDoc(data)
      setDocumentEditForm({
        title: data.title,
        source_module: data.source_module,
        source_type: data.source_type,
        tags: normalizeTags((data.tags ?? []).map((tag) => String(tag))),
        chunkingStrategy: typeof data.extra_meta?.chunking_strategy === 'string' ? data.extra_meta.chunking_strategy : 'fixed',
      })
    } catch (error) {
      setEditDialogOpen(false)
      setSelectedDoc(null)
      setSelectedDocId(null)
      showError(error instanceof Error ? error.message : 'Failed to load the document for editing')
    }
  }

  function cancelEditDocument() {
    setEditDialogOpen(false)
    setEditTagInputValue('')
    setDocumentEditForm(EMPTY_DOCUMENT_EDIT_FORM)
    setSelectedDoc(null)
    setSelectedDocId(null)
  }

  function closeMoreMenu() {
    setOpenMoreMenuDocUuid(null)
  }

  async function handleSaveDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedDocId) { showError('Select a document to edit first'); return }
    if (!documentEditForm.title.trim()) { showError('Document title is required'); return }
    try {
      setSavingDoc(true)
      const result = await updateDocument(selectedDocId, {
        title: documentEditForm.title.trim(),
        source_module: documentEditForm.source_module.trim(),
        source_type: documentEditForm.source_type.trim(),
        tags: normalizeTags(documentEditForm.tags),
        extra_meta: buildExtraMeta(documentEditForm.chunkingStrategy, selectedDoc?.extra_meta),
      })
      setEditDialogOpen(false)
      setEditTagInputValue('')
      await refreshDashboard()
      setSelectedDoc(null)
      setSelectedDocId(null)
      showSuccess(`Updated document “${result.title}”`)
    } catch (error) { showError(error instanceof Error ? error.message : 'Document update failed') }
    finally { setSavingDoc(false) }
  }

  return (
    <>
      <section className="panel hero-panel document-hero">
        <div className="hero-copy">
          <p className="eyebrow">Documents</p>
          <h2>Knowledge Document Management</h2>
          <p className="muted">Upload, view, edit, delete, and reindex documents while managing their metadata.</p>
        </div>
        <div className="hero-actions hero-actions-dashboard">
          <div className="summary-stat-grid">
            <div className="summary-stat">
              <strong>{documentsTotal}</strong>
              <span>Documents</span>
            </div>
            <div className="summary-stat">
              <strong>{jobsTotal}</strong>
              <span>Jobs</span>
            </div>
            <div className="summary-stat">
              <strong>{selectedIds.length}</strong>
              <span>Selected</span>
            </div>
          </div>
          <button className="secondary-button hero-action-button" type="button" onClick={() => void refreshDashboard()}>Refresh console</button>
        </div>
      </section>

      {toast ? <div className="toast-stack"><div className={`toast toast-${toast.tone}`}>{toast.message}</div></div> : null}

      <section className="panel">
        <SectionHeader eyebrow="System" title="Health and Configuration" stateLabel={getLoadStateLabel(healthState)} stateClass={`badge-${healthState}`} collapsed={healthCollapsed} onToggle={() => setHealthCollapsed((c) => !c)} />
        {!healthCollapsed ? (
          <div className="health-config-row">
            <div className="health-config-col">
              <p className="eyebrow" style={{marginBottom:6}}>Service status</p>
              {health ? (
                <div className="status-chips">
                  {Object.entries(health).slice(0, 6).map(([key, value]) => (
                    <span key={key} className={`status-chip status-chip-${getHealthTone(value)}`}>
                      {HEALTH_LABELS[key] ?? key}: {stringifyValue(value)}
                    </span>
                  ))}
                </div>
              ) : <p className="muted">Loading...</p>}
            </div>
            <div className="health-config-col">
              <p className="eyebrow" style={{marginBottom:6}}>Runtime configuration</p>
              {configs ? (
                <div className="status-chips">
                  <span className="status-chip status-chip-neutral">Environment: {configs.app_env}</span>
                  <span className="status-chip status-chip-neutral">Ingestion: {configs.ingestion_mode}</span>
                  <span className="status-chip status-chip-neutral">Fallbacks: {configs.allow_provider_fallbacks ? 'On' : 'Off'}</span>
                  <span className="status-chip status-chip-neutral">Embedding: {configs.embedding_model} / {configs.embedding_vector_size}d</span>
                  {configs.llm_model ? <span className="status-chip status-chip-neutral">LLM: {configs.llm_model}</span> : null}
                </div>
              ) : <p className="muted">Loading...</p>}
            </div>
          </div>
        ) : <p className="collapsed-summary">Collapsed by default. Expand to inspect service status and runtime settings.</p>}
      </section>

      <section className="grid two-up">
        <article className="panel">
          <SectionHeader eyebrow="Documents" title="Upload Document" stateLabel={uploading ? 'Uploading' : 'Ready'} />
          <form className="form-grid" onSubmit={handleUpload}>
            <FormField label="Document title" hint="The main title shown in document lists and search results.">
              <input type="text" value={uploadFields.title} onChange={(e) => setUploadFields((c) => ({ ...c, title: e.target.value }))} />
            </FormField>
            <FormField label="Knowledge base">
              <select value={uploadFields.source_module} onChange={(e) => setUploadFields((c) => ({ ...c, source_module: e.target.value }))}>
                {sourceModuleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </FormField>
            <FormField label="Document type">
              <select value={uploadFields.source_type} onChange={(e) => setUploadFields((c) => ({ ...c, source_type: e.target.value }))}>
                {sourceTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </FormField>
            <FormField label="Tags" spanTwo hint="Tags appear below the input. Press Enter to add one.">
              <div className="tag-editor compact-tag-editor">
                <input
                  type="text"
                  value={tagInputValue}
                  placeholder="Enter a tag and press Enter"
                  onChange={(e) => setTagInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addUploadTag(tagInputValue)
                    }
                  }}
                />
                <div className="tag-chip-row">
                  {uploadFields.tags.length > 0 ? uploadFields.tags.map((tag) => (
                    <button key={tag} type="button" className="tag-chip" onClick={() => removeUploadTag(tag)}>
                      {tag}<span>×</span>
                    </button>
                  )) : <span className="muted">No tags</span>}
                </div>
                {uploadTagSuggestions.length > 0 ? (
                  <div className="tag-suggestion-row">
                    {uploadTagSuggestions.map((tag) => (
                      <button key={tag} type="button" className="tag-suggestion-chip" onClick={() => addUploadTag(tag)}>{tag}</button>
                    ))}
                  </div>
                ) : null}
              </div>
            </FormField>
            <FormField label="Chunking strategy" spanTwo hint="Extended metadata currently configures the chunking strategy.">
              <select value={uploadFields.chunkingStrategy} onChange={(e) => setUploadFields((c) => ({ ...c, chunkingStrategy: e.target.value }))}>
                {chunkingStrategies.map((strategy) => (
                  <option key={strategy.name} value={strategy.name}>{getChunkingStrategyLabel(strategy.name)}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Upload file" spanTwo hint="Supports PDF, DOCX, XLSX, TXT, MD, HTML, CSV, EML, JSONL, and JPG/PNG/GIF/BMP/TIFF/WebP images.">
              <div className="file-upload-area">
                <label className="file-upload-label">
                  {uploadFile ? uploadFile.name : 'Choose a file...'}
                  <input key={uploadInputKey} type="file" className="file-upload-input" onChange={(e) => {
                    const file = e.target.files?.[0] ?? null
                    setUploadFile(file)
                    if (imagePreviewUrl) {
                      URL.revokeObjectURL(imagePreviewUrl)
                      setImagePreviewUrl(null)
                    }
                    if (file && isImageFile(file)) {
                      setImagePreviewUrl(URL.createObjectURL(file))
                    }
                  }} />
                </label>
                {uploadFile ? (
                  <button type="button" className="file-remove-btn" onClick={() => {
                    setUploadFile(null)
                    if (imagePreviewUrl) {
                      URL.revokeObjectURL(imagePreviewUrl)
                      setImagePreviewUrl(null)
                    }
                    setUploadInputKey((c) => c + 1)
                  }}>Remove</button>
                ) : null}
                {imagePreviewUrl ? (
                  <img 
                    src={imagePreviewUrl} 
                    alt="Image preview"
                    className="file-preview-thumb" 
                    onClick={() => setImagePreviewOpen(true)}
                    title="Click to view the original image"
                  />
                ) : null}
                {!uploadFields.title.trim() ? (
                  <p className="field-hint muted">Add a title before uploading the file.</p>
                ) : null}
              </div>
            </FormField>
            <div className="span-two form-submit-row">
              <button className="primary-button" type="submit" disabled={uploading}>{uploading ? 'Uploading...' : 'Upload document'}</button>
            </div>
          </form>
        </article>

        <article className="panel">
          <SectionHeader eyebrow="Documents" title="Document List" stateLabel={getLoadStateLabel(coreState)} stateClass={`badge-${coreState}`} />
          <form className="doc-filter-bar" onSubmit={applyDocumentFilters}>
            <div className="doc-filter-field">
              <label>Keywords</label>
              <input type="text" value={documentFilters.keyword} onChange={(e) => setDocumentFilters((c) => ({ ...c, keyword: e.target.value }))} placeholder="Search titles..." />
            </div>
            <div className="doc-filter-field">
              <label>Module</label>
              <select value={documentFilters.sourceModule} onChange={(e) => setDocumentFilters((c) => ({ ...c, sourceModule: e.target.value }))}>
                <option value="">All modules</option>
                {sourceModuleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="doc-filter-field">
              <label>Type</label>
              <select value={documentFilters.sourceType} onChange={(e) => setDocumentFilters((c) => ({ ...c, sourceType: e.target.value }))}>
                <option value="">All types</option>
                {sourceTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="doc-filter-actions">
              <button className="secondary-button compact-button" type="submit">Search</button>
              <button className="secondary-button compact-button" type="button" onClick={resetDocumentFilters}>Reset</button>
            </div>
          </form>
          <div className="doc-batch-bar">
            <span className="muted">{selectedSummary}</span>
            <div className="doc-batch-actions">
              <button className="secondary-button compact-button" type="button" onClick={toggleVisibleSelection}>{allVisibleSelected ? 'Clear selection' : 'Select all'}</button>
              <button className="danger-button compact-button" type="button" onClick={() => void handleBatchDelete()}>Delete selected</button>
              <button className="secondary-button compact-button" type="button" onClick={() => void handleBatchReindex()}>Reindex selected</button>
            </div>
          </div>
          {documents.length > 0 ? (
            <table className="doc-table">
              <thead><tr><th style={{width:30}}></th><th className="doc-title-col">Title</th><th>Module</th><th>Status</th><th style={{width:220}}>Actions</th></tr></thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.doc_uuid} className={selectedDocId === doc.doc_uuid ? 'row-selected' : ''}>
                    <td className="doc-select-cell"><input className="doc-row-checkbox" type="checkbox" checked={selectedIds.includes(doc.doc_uuid)} onChange={() => toggleSelected(doc.doc_uuid)} onClick={(e) => e.stopPropagation()} /></td>
                    <td className="doc-title-col">
                      <div className="doc-title-with-icon">
                        {isImageExtension(doc.file_ext) ? <span className="doc-type-icon" title="Image file">🖼️</span> : null}
                        <strong>{doc.title || doc.doc_uuid.slice(0, 8)}</strong>
                      </div>
                    </td>
                    <td>{getFieldLabel(fieldOptions, 'source_module', doc.source_module)} · {getFieldLabel(fieldOptions, 'source_type', doc.source_type)}</td>
                    <td><span className={`status-chip status-chip-${doc.parse_status === 'success' ? 'success' : 'warning'}`}>{doc.parse_status}/{doc.index_status}</span></td>
                    <td className="doc-actions-cell">
                      <button className="secondary-button small" type="button" onClick={() => void openDocumentDetail(doc.doc_uuid)}>View</button>
                      <button className="danger-button small" type="button" onClick={() => void handleBatchDelete([doc.doc_uuid])}>Delete</button>
                      <div className="more-menu-wrap">
                        <button
                          className="secondary-button small"
                          type="button"
                          aria-expanded={openMoreMenuDocUuid === doc.doc_uuid}
                          onClick={() => setOpenMoreMenuDocUuid((current) => current === doc.doc_uuid ? null : doc.doc_uuid)}
                        >
                          More
                        </button>
                        {openMoreMenuDocUuid === doc.doc_uuid ? (
                          <>
                            <button className="menu-backdrop" type="button" aria-label="Close more actions" onClick={closeMoreMenu} />
                            <div className="more-menu" role="menu">
                              {doc.file_exists ? (
                                <button className="more-menu-item" type="button" onClick={() => { downloadDocumentFile(doc.doc_uuid); closeMoreMenu() }}>Download</button>
                              ) : (
                                <button className="more-menu-item" type="button" disabled onClick={closeMoreMenu}>Source file missing</button>
                              )}
                              <button className="more-menu-item" type="button" onClick={() => { void startEditDocument(doc.doc_uuid); closeMoreMenu() }}>Edit</button>
                              <button className="more-menu-item" type="button" onClick={() => { void handleBatchReindex([doc.doc_uuid]); closeMoreMenu() }}>Reindex</button>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No documents yet.</p>}
          {documentPageCount > 1 && (
            <div className="pagination">
              <button disabled={documentQuery.page <= 1} onClick={() => setDocumentQuery((c) => ({ ...c, page: c.page - 1 }))}>Previous</button>
              <span>{documentQuery.page} / {documentPageCount}</span>
              <button disabled={documentQuery.page >= documentPageCount} onClick={() => setDocumentQuery((c) => ({ ...c, page: c.page + 1 }))}>Next</button>
            </div>
          )}
        </article>
      </section>

      {isAsyncMode ? (
        <section className="grid two-up">
          <article className="panel">
            <SectionHeader eyebrow="Jobs" title="Background Processing" stateLabel={getLoadStateLabel(coreState)} stateClass={`badge-${coreState}`} />
            <form className="form-grid compact-form" onSubmit={applyJobFilters}>
              <FormField label="Status"><input type="text" value={jobFilters.status} onChange={(e) => setJobFilters((c) => ({ ...c, status: e.target.value }))} /></FormField>
              <div className="span-two form-submit-row">
                <button className="secondary-button" type="submit">Search</button>
                <button className="secondary-button" type="button" onClick={resetJobFilters}>Reset</button>
              </div>
            </form>
            {jobs.length > 0 ? (
              <div className="mini-list">
                {jobs.map((job) => (
                  <div key={job.job_uuid} className="mini-list-item align-left">
                    <strong>{getJobTypeLabel(job.job_type)}</strong>
                    <small>Status: <span className={`status-chip status-chip-${getJobTone(job.status)}`}>{getJobStatusLabel(job.status)}</span></small>
                    <small>Progress: {getJobStepLabel(job.current_step)} · {formatDateTime(job.created_at)}</small>
                    {job.error_message ? <small className="error-text">{job.error_message}</small> : null}
                  </div>
                ))}
              </div>
            ) : <p className="muted">No background jobs yet.</p>}
            {jobPageCount > 1 && (
              <div className="pagination">
                <button disabled={jobQuery.page <= 1} onClick={() => setJobQuery((c) => ({ ...c, page: c.page - 1 }))}>Previous</button>
                <span>{jobQuery.page} / {jobPageCount}</span>
                <button disabled={jobQuery.page >= jobPageCount} onClick={() => setJobQuery((c) => ({ ...c, page: c.page + 1 }))}>Next</button>
              </div>
            )}
          </article>
        </section>
      ) : null}

      {selectedDoc && !editDialogOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => { setSelectedDocId(null); setSelectedDoc(null) }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="document-view-dialog-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">Document</p>
                <h3 id="document-view-dialog-title">Document Details</h3>
              </div>
              <div className="document-actions">
                {selectedDoc.file_exists ? (
                  <button className="secondary-button compact-button" type="button" onClick={() => downloadDocumentFile(selectedDoc.doc_uuid)}>Download source file</button>
                ) : null}
                <button className="secondary-button compact-button" type="button" onClick={() => { setSelectedDocId(null); setSelectedDoc(null) }}>Close</button>
              </div>
            </div>
            <dl className="definition-list">
              <div className="definition-row"><dt>Title</dt><dd>{selectedDoc.title}</dd></div>
              <div className="definition-row"><dt>UUID</dt><dd>{selectedDoc.doc_uuid}</dd></div>
              <div className="definition-row"><dt>File name</dt><dd>{selectedDoc.file_name}</dd></div>
              <div className="definition-row"><dt>Knowledge base</dt><dd>{getFieldLabel(fieldOptions, 'source_module', selectedDoc.source_module)}</dd></div>
              <div className="definition-row"><dt>Document type</dt><dd>{getFieldLabel(fieldOptions, 'source_type', selectedDoc.source_type)}</dd></div>
              <div className="definition-row"><dt>Tags</dt><dd>{selectedDoc.tags.length > 0 ? selectedDoc.tags.join(', ') : 'None'}</dd></div>
              <div className="definition-row"><dt>Chunking strategy</dt><dd>{getChunkingStrategyLabel(String(selectedDoc.extra_meta?.chunking_strategy ?? 'fixed'))}</dd></div>
              <div className="definition-row"><dt>Chunks</dt><dd>{selectedDoc.chunk_count}</dd></div>
              <div className="definition-row"><dt>File available</dt><dd><span className={`status-chip status-chip-${selectedDoc.file_exists ? 'success' : 'danger'}`}>{selectedDoc.file_exists ? 'Yes' : 'No'}</span></dd></div>
              {isImageExtension(selectedDoc.file_ext) ? (
                <>
                  <div className="definition-row"><dt>File type</dt><dd><span className="status-chip status-chip-info">Image</span></dd></div>
                  {selectedDoc.file_exists ? (
                    <div className="definition-row">
                      <dt>Image preview</dt>
                      <dd>
                        <div className="image-preview-container large">
                          <img 
                            src={`${API_BASE}/documents/${selectedDoc.doc_uuid}/download`} 
                            alt={selectedDoc.title} 
                            className="image-preview"
                          />
                        </div>
                      </dd>
                    </div>
                  ) : null}
                </>
              ) : null}
            </dl>
          </div>
        </div>
      ) : null}

      {editDialogOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={cancelEditDocument}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="document-edit-dialog-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">Document</p>
                <h3 id="document-edit-dialog-title">Edit Document</h3>
              </div>
              <button className="secondary-button compact-button" type="button" onClick={cancelEditDocument}>Close</button>
            </div>
            <form className="form-grid compact-form" onSubmit={handleSaveDocument}>
              <FormField label="Title"><input type="text" value={documentEditForm.title} onChange={(e) => setDocumentEditForm((c) => ({ ...c, title: e.target.value }))} /></FormField>
            <FormField label="Knowledge base">
                <select value={documentEditForm.source_module} onChange={(e) => setDocumentEditForm((c) => ({ ...c, source_module: e.target.value }))}>
                  {getFieldOptions(fieldOptions, 'source_module', documentEditForm.source_module).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </FormField>
              <FormField label="Document type">
                <select value={documentEditForm.source_type} onChange={(e) => setDocumentEditForm((c) => ({ ...c, source_type: e.target.value }))}>
                  {getFieldOptions(fieldOptions, 'source_type', documentEditForm.source_type).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </FormField>
              <FormField label="Tags" spanTwo hint="Selected tags appear below. Press Enter to add another.">
                <div className="tag-editor compact-tag-editor">
                  <input
                    type="text"
                    value={editTagInputValue}
                    placeholder="Enter a tag and press Enter"
                    onChange={(e) => setEditTagInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addEditTag(editTagInputValue)
                      }
                    }}
                  />
                  <div className="tag-chip-row">
                    {documentEditForm.tags.length > 0 ? documentEditForm.tags.map((tag) => (
                      <button key={tag} type="button" className="tag-chip" onClick={() => removeEditTag(tag)}>{tag}<span>×</span></button>
                    )) : <span className="muted">No tags</span>}
                  </div>
                  {editTagSuggestions.length > 0 ? (
                    <div className="tag-suggestion-row">
                      {editTagSuggestions.map((tag) => (
                        <button key={tag} type="button" className="tag-suggestion-chip" onClick={() => addEditTag(tag)}>{tag}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </FormField>
              <FormField label="Chunking strategy" spanTwo>
                <select value={documentEditForm.chunkingStrategy} onChange={(e) => setDocumentEditForm((c) => ({ ...c, chunkingStrategy: e.target.value }))}>
                  {chunkingStrategies.map((strategy) => (
                    <option key={strategy.name} value={strategy.name}>{getChunkingStrategyLabel(strategy.name)}</option>
                  ))}
                </select>
              </FormField>
              <div className="span-two form-submit-row">
                <button className="secondary-button" type="button" onClick={cancelEditDocument}>Cancel</button>
                <button className="primary-button" type="submit" disabled={savingDoc}>{savingDoc ? 'Saving...' : 'Save changes'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {imagePreviewOpen && imagePreviewUrl ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setImagePreviewOpen(false)}>
          <div className="modal-card image-preview-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">Image Preview</p>
                <h3>{uploadFile?.name || 'Image'}</h3>
              </div>
              <button className="secondary-button compact-button" type="button" onClick={() => setImagePreviewOpen(false)}>Close</button>
            </div>
            <div className="image-preview-modal-body">
              <img src={imagePreviewUrl} alt="Full-size preview" className="image-preview-full" />
            </div>
          </div>
        </div>
      ) : null}

    </>
  )
}
