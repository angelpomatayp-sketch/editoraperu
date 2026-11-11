import { describe, expect, it } from 'vitest'
import { NAME_MAX_LENGTH, normalizeName, validateParticipant } from '../../src/shared/participant'
import { shouldAutoCapitalize, typeDigitKey, typeNameKey } from '../../src/shared/typing'

const valid = { firstNames: 'Ana', lastNames: 'Quispe', dni: '12345678' }

describe('validación de nombres (RF-REG-002)', () => {
  it.each(['José María', "D'Angelo", 'O’Brien', 'Pérez-Albela', 'Ñuñez Güémez', '  Luis   Ángel  '])('acepta %s', (name) => {
    expect(validateParticipant({ ...valid, firstNames: name }).ok).toBe(true)
  })

  it('normaliza espacios al inicio, al final y repetidos', () => {
    const result = validateParticipant({ ...valid, firstNames: '  Luis   Ángel  ' })
    expect(result.ok && result.data.firstNames).toBe('Luis Ángel')
    expect(normalizeName('José')).toBe('José')
  })

  it.each([
    ['', 'Ingrese sus nombres'],
    ['    ', 'Ingrese sus nombres'],
    ['A', 'al menos'],
    ['Juan2', 'solo letras'],
    ['<script>', 'solo letras'],
    ['Ana--María', 'solo letras'],
    ["'Ana", 'solo letras'],
    ['A'.repeat(NAME_MAX_LENGTH + 1), 'no pueden superar']
  ])('rechaza "%s"', (name, message) => {
    const result = validateParticipant({ ...valid, firstNames: name })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.firstNames).toContain(message)
  })

  it('informa el error de cada campo por separado', () => {
    const result = validateParticipant({ firstNames: '', lastNames: '1', dni: '12' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['dni', 'firstNames', 'lastNames'])
  })
})

describe('validación de DNI (RF-REG-003)', () => {
  it('acepta exactamente ocho dígitos', () => {
    expect(validateParticipant({ ...valid, dni: ' 01234567 ' }).ok).toBe(true)
  })

  it.each(['1234567', '123456789', '1234567a', '1234-5678', ''])('rechaza "%s"', (dni) => {
    expect(validateParticipant({ ...valid, dni }).ok).toBe(false)
  })
})

describe('escritura con el teclado en pantalla', () => {
  it('pone mayúscula al inicio de cada palabra', () => {
    let value = ''
    for (const key of ['m', 'a', 'r', 'í', 'a', ' ', 'j', 'o', 's', 'é']) value = typeNameKey(value, key, false, 60)
    expect(value).toBe('María José')
  })

  it('Mayús invierte la mayúscula automática para la siguiente letra', () => {
    expect(typeNameKey('', 'd', true, 60)).toBe('d')
    expect(typeNameKey('Ana', 'b', true, 60)).toBe('AnaB')
  })

  it('no permite separadores al inicio ni repetidos', () => {
    expect(typeNameKey('', ' ', false, 60)).toBe('')
    expect(typeNameKey('Ana ', '-', false, 60)).toBe('Ana ')
    expect(typeNameKey('Ana', '-', false, 60)).toBe('Ana-')
    expect(shouldAutoCapitalize("D'")).toBe(true)
  })

  it('respeta la longitud máxima y acepta solo dígitos en el DNI', () => {
    expect(typeNameKey('Ana', 'b', false, 3)).toBe('Ana')
    expect(typeDigitKey('1234567', '8', 8)).toBe('12345678')
    expect(typeDigitKey('12345678', '9', 8)).toBe('12345678')
    expect(typeDigitKey('12', 'a', 8)).toBe('12')
  })
})
