/**
 * CSV compatible con Excel (RF-REP-002): UTF-8 con BOM para que se lean bien las tildes, todos los
 * valores entre comillas y saltos de línea CRLF.
 */
export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | boolean | null | undefined
}

/**
 * Neutraliza valores que Excel interpretaría como fórmulas (`=`, `+`, `-`, `@`, tabulación o retorno
 * al inicio) anteponiendo un apóstrofo (RF-REP-003, inyección CSV).
 */
export function neutralize(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '""'
  const text = typeof value === 'string' ? neutralize(value) : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}
