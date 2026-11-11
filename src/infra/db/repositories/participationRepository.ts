import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { NewParticipation, ParticipationRepository } from '../../../core/participants/registrationService'

export class SqliteParticipationRepository implements ParticipationRepository {
  constructor(private readonly db: DatabaseSync) {}

  insertWithConsents(p: NewParticipation): void {
    const insertParticipation = this.db.prepare(
      `INSERT INTO participations
         (id, campaign_id, campaign_config_version, first_names, last_names, document_type, document_number,
          selections_json, status, started_at, confirmed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'DNI', ?, ?, 'registered', ?, ?, ?, ?)`
    )
    const insertConsent = this.db.prepare(
      `INSERT INTO consents (id, participation_id, consent_version_id, accepted, recorded_at) VALUES (?, ?, ?, ?, ?)`
    )

    this.db.exec('BEGIN IMMEDIATE')
    try {
      insertParticipation.run(
        p.id,
        p.campaignId,
        p.campaignConfigVersion,
        p.participant.firstNames,
        p.participant.lastNames,
        p.participant.dni,
        JSON.stringify(p.selections),
        p.startedAt,
        p.confirmedAt,
        p.confirmedAt,
        p.confirmedAt
      )
      for (const consent of p.consents) {
        insertConsent.run(randomUUID(), p.id, consent.versionId, consent.accepted ? 1 : 0, p.confirmedAt)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  markCompleted(participationId: string, finishedAt: string): void {
    this.db
      .prepare(
        `UPDATE participations SET status = 'completed', finished_at = ?, updated_at = ?
         WHERE id = ? AND status = 'composed'`
      )
      .run(finishedAt, finishedAt, participationId)
  }

  closeInterrupted(finishedAt: string): number {
    const result = this.db
      .prepare(
        `UPDATE participations SET status = 'cancelled', finished_at = ?, updated_at = ?
         WHERE status IN ('registered', 'captured', 'composed')`
      )
      .run(finishedAt, finishedAt)
    return Number(result.changes)
  }

  markCancelled(participationId: string, finishedAt: string): void {
    this.db
      .prepare(
        `UPDATE participations SET status = 'cancelled', finished_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('registered', 'captured', 'composed')`
      )
      .run(finishedAt, finishedAt, participationId)
  }
}
