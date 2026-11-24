import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrap } from '../../src/main/bootstrap'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'totem-test-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('arranque (RF-KIO-001, RF-ALM-001)', () => {
  it('crea las carpetas de datos, migra la base y registra el inicio', () => {
    const root = tempRoot()
    const outcome = bootstrap({ dataRoot: root, isDev: false, version: '0.0.0-test' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(readdirSync(root).sort()).toEqual(['config', 'content', 'db', 'logs', 'photos', 'tmp'])
    expect(readdirSync(join(root, 'photos')).sort()).toEqual(['finals', 'originals'])
    expect(outcome.context.schemaVersion).toBe(10)

    const event = outcome.context.db
      .prepare("SELECT category, action, result FROM audit_events WHERE action = 'start'")
      .get()
    expect(event).toEqual({ category: 'system', action: 'start', result: 'ok' })
    expect(readdirSync(join(root, 'logs')).some((f) => f.endsWith('.log'))).toBe(true)
    outcome.context.db.close()
  })

  it('un segundo arranque reutiliza la base sin volver a migrar', () => {
    const root = tempRoot()
    const first = bootstrap({ dataRoot: root, isDev: false, version: 'test' })
    if (first.ok) first.context.db.close()
    const second = bootstrap({ dataRoot: root, isDev: false, version: 'test' })
    expect(second.ok).toBe(true)
    if (second.ok) {
      const starts = second.context.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'start'").get()
      expect(starts).toEqual({ n: 2 })
      second.context.db.close()
    }
  })

  it('usa el servicio incluido en el instalador si el panel no tiene uno propio, y el del panel si lo tiene', () => {
    const root = tempRoot()
    const builtIn = { baseUrl: 'https://incluido.ejemplo.pe', secret: 'clave-incluida-de-al-menos-treinta-y-dos-caracteres' }
    let panelSecret: string | null = null
    const outcome = bootstrap({ dataRoot: root, isDev: false, version: 'test', publicationDefaults: builtIn, publicationSecret: () => panelSecret })
    if (!outcome.ok) throw new Error('no arrancó')
    const baseOf = () => (outcome.context.publicationClient() as unknown as { base: URL } | null)?.base.href

    expect(baseOf()).toBe('https://incluido.ejemplo.pe/')

    const settings = outcome.context.settings
    settings.update({ ...settings.get(), publication: { ...settings.get().publication, baseUrl: 'https://propio.ejemplo.pe' } }, 'test')
    panelSecret = 'clave-propia-de-al-menos-treinta-y-dos-caracteres'
    expect(baseOf()).toBe('https://propio.ejemplo.pe/')
    outcome.context.db.close()
  })

  it('sin servicio incluido ni configurado no hay publicación', () => {
    const root = tempRoot()
    const outcome = bootstrap({ dataRoot: root, isDev: false, version: 'test' })
    if (!outcome.ok) throw new Error('no arrancó')
    expect(outcome.context.publicationClient()).toBeNull()
    outcome.context.db.close()
  })

  it('una base dañada produce un fallo esencial controlado', () => {
    const root = tempRoot()
    const first = bootstrap({ dataRoot: root, isDev: false, version: 'test' })
    if (first.ok) first.context.db.close()
    for (const file of readdirSync(join(root, 'db'))) rmSync(join(root, 'db', file))
    writeFileSync(join(root, 'db', 'totem.sqlite'), 'esto no es una base sqlite'.repeat(200))

    const outcome = bootstrap({ dataRoot: root, isDev: false, version: 'test' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.failure).toBe('database_corrupt')
  })
})
