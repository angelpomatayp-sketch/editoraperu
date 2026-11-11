import type { ConsentText } from '../../shared/registration'

export interface ConsentRepository {
  /** Versiones vigentes, una por tipo, en el orden en que se presentan (RF-CON-001). */
  listActive(): ConsentText[]
}
