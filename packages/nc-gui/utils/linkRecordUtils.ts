export const normalizeLocalLinkedRecords = (value: unknown): Record<string, any>[] => {
  if (Array.isArray(value)) return value

  return value !== null && typeof value === 'object' ? [value as Record<string, any>] : []
}
