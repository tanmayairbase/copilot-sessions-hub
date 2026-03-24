const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export const normalizeExternalUrl = (value: string): string | null => {
  const candidate = value.trim()
  if (!candidate) {
    return null
  }

  try {
    const parsed = new URL(candidate)
    if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}
