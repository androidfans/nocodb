import { RecordDeleteProtectionMetaProp, parseProp } from 'nocodb-sdk'

export function canConfigureRecordDeleteProtection(column: any, isXcdbBase: boolean, tableColumns: any[] = []): boolean {
  const meta = parseProp(column?.meta)
  return isXcdbBase && tableColumns.filter((candidate) => candidate.pk).length === 1 && !column?.is_custom_link && !meta?.custom
}

export function isRecordDeleteProtectionEnabled(column: any): boolean {
  return parseProp(column?.meta)?.[RecordDeleteProtectionMetaProp] === true
}

export function withRecordDeleteProtection(column: any, enabled: boolean): Record<string, any> {
  return {
    ...(parseProp(column?.meta) || {}),
    [RecordDeleteProtectionMetaProp]: enabled,
  }
}
