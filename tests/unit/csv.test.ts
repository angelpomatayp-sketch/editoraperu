import { describe, expect, it } from 'vitest'
import { neutralize, toCsv } from '../../src/core/reports/csv'

describe('CSV compatible con Excel (RF-REP-002, RF-REP-003)', () => {
  it('neutraliza valores que Excel interpretaría como fórmulas', () => {
    for (const value of ['=HYPERLINK("http://x")', '+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd']) {
      expect(neutralize(value).startsWith("'")).toBe(true)
    }
    expect(neutralize('José Pérez')).toBe('José Pérez')
  })

  it('usa BOM UTF-8, comillas en todos los valores, comillas escapadas y CRLF', () => {
    const csv = toCsv(
      [
        { a: 'Ñuñez "el lector"', b: 3, c: null },
        { a: '=1+1', b: -5, c: true }
      ],
      [
        { header: 'Nombre', value: (r) => r.a },
        { header: 'Número', value: (r) => r.b },
        { header: 'Otro', value: (r) => r.c }
      ]
    )
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1)).toBe('"Nombre","Número","Otro"\r\n"Ñuñez ""el lector""","3",""\r\n"\'=1+1","-5","true"\r\n')
  })
})
