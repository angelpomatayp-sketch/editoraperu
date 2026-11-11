import { describe, expect, it } from 'vitest'
import { maxCharacters, type CampaignDetail } from '../../src/shared/campaign'

type Detail = Pick<CampaignDetail, 'characterMode' | 'characterSlots' | 'characters'>

const character = (id: string, scenarioIds: string[]) => ({ id, scenarioIds }) as unknown as CampaignDetail['characters'][number]
const slots = (n: number) => Array.from({ length: n }, () => ({})) as unknown as CampaignDetail['characterSlots']

describe('máximo de personajes a elegir', () => {
  const detail: Detail = {
    characterMode: 'optional',
    characterSlots: slots(2),
    characters: [character('inca', ['machu']), character('lectora', ['biblio']), character('lector', ['biblio'])]
  }

  it('sin escenario: las posiciones de la campaña', () => {
    expect(maxCharacters(detail)).toBe(2)
  })

  it('nunca más que los personajes del escenario', () => {
    expect(maxCharacters(detail, 'machu')).toBe(1)
    expect(maxCharacters(detail, 'biblio')).toBe(2)
  })

  it('ni más que las posiciones aunque haya más personajes', () => {
    expect(maxCharacters({ ...detail, characterSlots: slots(1) }, 'biblio')).toBe(1)
  })

  it('sin personajes en la campaña: cero', () => {
    expect(maxCharacters({ ...detail, characterMode: 'none' }, 'biblio')).toBe(0)
  })
})
