export function parseStringArrayJson(raw: string, fieldName: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${fieldName} must be valid JSON`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON array`)
  }
  return parsed.map((item) => String(item))
}

export function parseRecordJson(raw: string, fieldName: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${fieldName} must be valid JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

export function parseCsv(raw: string) {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('en-US')
}

export function stringifyValue(value: unknown) {
  if (value === null || value === undefined) {
    return '—'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

export function getLoadStateLabel(state: 'idle' | 'loading' | 'ready' | 'error') {
  switch (state) {
    case 'loading':
      return 'Loading'
    case 'ready':
      return 'Ready'
    case 'error':
      return 'Error'
    default:
      return 'Pending'
  }
}

export function getHealthTone(value: unknown): 'neutral' | 'success' | 'warning' | 'danger' {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'up' || normalized === 'configured' || normalized === 'true') {
    return 'success'
  }
  if (normalized === 'loading' || normalized === 'pending') {
    return 'warning'
  }
  if (normalized === 'error' || normalized === 'down') {
    return 'danger'
  }
  return 'neutral'
}

export function getJobTone(value: string): 'neutral' | 'success' | 'warning' | 'danger' {
  const normalized = value.toLowerCase()
  if (normalized === 'success' || normalized === 'done' || normalized === 'indexed') {
    return 'success'
  }
  if (normalized === 'partial_success') {
    return 'warning'
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'danger'
  }
  if (normalized === 'running' || normalized === 'pending' || normalized === 'created') {
    return 'warning'
  }
  return 'neutral'
}
