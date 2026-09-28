import { useEffect, useMemo, useState } from 'react'
import { fetchDocuments } from '../api'
import { SectionHeader } from '../components/shared'
import {
  DEFAULT_FIELD_OPTIONS_CONFIG,
  FIELD_LABELS,
  FIELD_ORDER,
  loadFieldOptionsSystemConfig,
  saveFieldOptionsSystemConfig,
} from '../fieldOptions'
import type { FieldKey, FieldOption, FieldOptionsConfig } from '../types'

type ToastTone = 'success' | 'danger'

type ToastState = {
  id: number
  tone: ToastTone
  message: string
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

const FIELD_DESCRIPTIONS: Record<FieldKey, string> = {
  source_module: 'Used for resource ownership and permission matching.',
  source_type: 'Used for document classification and retrieval filters.',
}

function emptyOption(sortOrder: number): FieldOption {
  return { value: '', label: '', enabled: true, sort_order: sortOrder }
}

function normalizeEditableConfig(config: FieldOptionsConfig): FieldOptionsConfig {
  return {
    fields: Object.fromEntries(
      FIELD_ORDER.map((fieldKey) => {
        const options = config.fields[fieldKey]
          .map((option, index) => ({
            value: option.value.trim(),
            label: option.label.trim(),
            enabled: option.enabled,
            sort_order: Number.isFinite(option.sort_order) ? option.sort_order : (index + 1) * 10,
          }))
          .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'zh-CN'))
        return [fieldKey, options]
      }),
    ) as Record<FieldKey, FieldOption[]>,
  }
}

export function SettingsPage() {
  const [configId, setConfigId] = useState<number | null>(null)
  const [fieldOptions, setFieldOptions] = useState<FieldOptionsConfig>(DEFAULT_FIELD_OPTIONS_CONFIG)
  const [usedValues, setUsedValues] = useState<Record<FieldKey, Set<string>>>({
    source_module: new Set(),
    source_type: new Set(),
  })
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  const enabledCount = useMemo(() => {
    return FIELD_ORDER.reduce((total, fieldKey) => {
      return total + fieldOptions.fields[fieldKey].filter((option) => option.enabled && option.value.trim()).length
    }, 0)
  }, [fieldOptions])

  async function refreshSettings() {
    setLoadState('loading')
    try {
      const [configData, documentsData] = await Promise.all([
        loadFieldOptionsSystemConfig(),
        fetchDocuments({ pageSize: 100 }),
      ])
      setConfigId(configData.item.id)
      setFieldOptions(configData.config)
      setUsedValues({
        source_module: new Set(documentsData.items.map((doc) => doc.source_module).filter(Boolean)),
        source_type: new Set(documentsData.items.map((doc) => doc.source_type).filter(Boolean)),
      })
      setLoadState('ready')
    } catch (error) {
      setLoadState('error')
      showToast(error instanceof Error ? error.message : 'Failed to load field configuration', 'danger')
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        setLoadState('loading')
        try {
          const [configData, documentsData] = await Promise.all([
            loadFieldOptionsSystemConfig(),
            fetchDocuments({ pageSize: 100 }),
          ])
          setConfigId(configData.item.id)
          setFieldOptions(configData.config)
          setUsedValues({
            source_module: new Set(documentsData.items.map((doc) => doc.source_module).filter(Boolean)),
            source_type: new Set(documentsData.items.map((doc) => doc.source_type).filter(Boolean)),
          })
          setLoadState('ready')
        } catch (error) {
          setLoadState('error')
          showToast(error instanceof Error ? error.message : 'Failed to load field configuration', 'danger')
        }
      })()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeoutId = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(timeoutId)
  }, [toast])

  function showToast(message: string, tone: ToastTone) {
    setToast({ id: Date.now(), tone, message })
  }

  function updateOption(fieldKey: FieldKey, index: number, patch: Partial<FieldOption>) {
    setFieldOptions((current) => ({
      fields: {
        ...current.fields,
        [fieldKey]: current.fields[fieldKey].map((option, optionIndex) =>
          optionIndex === index ? { ...option, ...patch } : option,
        ),
      },
    }))
  }

  function addOption(fieldKey: FieldKey) {
    setFieldOptions((current) => {
      const maxOrder = current.fields[fieldKey].reduce((max, option) => Math.max(max, option.sort_order), 0)
      return {
        fields: {
          ...current.fields,
          [fieldKey]: [...current.fields[fieldKey], emptyOption(maxOrder + 10)],
        },
      }
    })
  }

  function removeOption(fieldKey: FieldKey, index: number) {
    const option = fieldOptions.fields[fieldKey][index]
    if (usedValues[fieldKey].has(option.value)) {
      showToast(`${option.label || option.value} is used by existing documents and cannot be deleted`, 'danger')
      return
    }
    setFieldOptions((current) => ({
      fields: {
        ...current.fields,
        [fieldKey]: current.fields[fieldKey].filter((_, optionIndex) => optionIndex !== index),
      },
    }))
  }

  function validateConfig(config: FieldOptionsConfig) {
    for (const fieldKey of FIELD_ORDER) {
      const seen = new Set<string>()
      for (const option of config.fields[fieldKey]) {
        const value = option.value.trim()
        const label = option.label.trim()
        if (!value || !label) return `${FIELD_LABELS[fieldKey]} contains an empty code or label`
        if (seen.has(value)) return `${FIELD_LABELS[fieldKey]} contains a duplicate code: ${value}`
        seen.add(value)
      }
      if (!config.fields[fieldKey].some((option) => option.enabled)) {
        return `${FIELD_LABELS[fieldKey]} requires at least one enabled option`
      }
    }
    return null
  }

  async function handleSave() {
    const error = validateConfig(fieldOptions)
    if (error) {
      showToast(error, 'danger')
      return
    }
    try {
      setSaving(true)
      const normalized = normalizeEditableConfig(fieldOptions)
      const savedConfig = await saveFieldOptionsSystemConfig(configId, normalized)
      setConfigId(savedConfig.id)
      setFieldOptions(normalized)
      showToast('Field options saved', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Save failed', 'danger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <section className="panel hero-panel compact-hero">
        <div className="hero-copy">
          <p className="eyebrow">Settings</p>
          <h2>Field Option Configuration</h2>
          <p className="muted">Manage knowledge-base and document-type options in one place. Other pages use enabled values after you save.</p>
        </div>
        <div className="hero-actions settings-hero-actions">
          <div className="summary-stat settings-summary-stat">
            <strong>{enabledCount}</strong>
            <span>Enabled options</span>
          </div>
          <button className="secondary-button settings-hero-button" type="button" onClick={() => void refreshSettings()}>Refresh</button>
          <button className="primary-button settings-hero-button" type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving...' : 'Save configuration'}
          </button>
        </div>
      </section>

      {toast ? <div className="toast-stack"><div className={`toast toast-${toast.tone}`}>{toast.message}</div></div> : null}

      <section className="panel">
        <SectionHeader
          eyebrow="Field dictionary"
          title="Metadata Options"
          stateLabel={loadState === 'loading' ? 'Loading' : loadState === 'error' ? 'Failed' : 'Ready'}
          stateClass={`badge-${loadState === 'error' ? 'error' : loadState === 'ready' ? 'ready' : 'loading'}`}
        />
        <div className="field-option-grid">
          {FIELD_ORDER.map((fieldKey) => (
            <article className="field-option-section" key={fieldKey}>
              <div className="field-option-head">
                <div>
                  <h4>{FIELD_LABELS[fieldKey]}</h4>
                  <p>{FIELD_DESCRIPTIONS[fieldKey]}</p>
                </div>
                <button className="secondary-button compact-button" type="button" onClick={() => addOption(fieldKey)}>
                  Add
                </button>
              </div>
              <div className="field-option-table-shell">
                <table className="field-option-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Display name</th>
                      <th>Order</th>
                      <th>Enabled</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fieldOptions.fields[fieldKey].map((option, index) => {
                      const used = usedValues[fieldKey].has(option.value)
                      return (
                        <tr key={`${fieldKey}-${index}`}>
                          <td>
                            <input
                              type="text"
                              value={option.value}
                              onChange={(event) => updateOption(fieldKey, index, { value: event.target.value.trim() })}
                              disabled={used}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={option.label}
                              onChange={(event) => updateOption(fieldKey, index, { label: event.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              value={option.sort_order}
                              onChange={(event) => updateOption(fieldKey, index, { sort_order: Number(event.target.value) || 0 })}
                            />
                          </td>
                          <td>
                            <label className="toggle-row">
                              <input
                                type="checkbox"
                                checked={option.enabled}
                                onChange={(event) => updateOption(fieldKey, index, { enabled: event.target.checked })}
                              />
                              <span>{option.enabled ? 'Enabled' : 'Disabled'}</span>
                            </label>
                          </td>
                          <td>
                            <button
                              className="danger-button compact-button"
                              type="button"
                              disabled={used}
                              onClick={() => removeOption(fieldKey, index)}
                            >
                              {used ? 'In use' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}
