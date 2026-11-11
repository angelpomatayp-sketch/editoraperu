import type { DatabaseSync } from 'node:sqlite'
import type { UserRecord, UserRepository } from '../../../core/auth/adminAuth'
import type { Role } from '../../../shared/admin'

interface UserRow {
  id: string
  username: string
  display_name: string
  role: Role
  status: 'active' | 'disabled'
  password_hash: string
  must_change_password: number
  failed_attempts: number
  locked_until: string | null
  last_login_at: string | null
}

const COLUMNS = 'id, username, display_name, role, status, password_hash, must_change_password, failed_attempts, locked_until, last_login_at'

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    passwordHash: row.password_hash,
    mustChangePassword: row.must_change_password === 1,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at
  }
}

const FIELD_COLUMNS: Record<string, string> = {
  displayName: 'display_name',
  role: 'role',
  status: 'status',
  passwordHash: 'password_hash',
  mustChangePassword: 'must_change_password',
  failedAttempts: 'failed_attempts',
  lockedUntil: 'locked_until',
  lastLoginAt: 'last_login_at'
}

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: DatabaseSync) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
  }

  findByUsername(username: string): UserRecord | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM users WHERE username = ?`).get(username) as UserRow | undefined
    return row ? toRecord(row) : null
  }

  findById(id: string): UserRecord | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id) as UserRow | undefined
    return row ? toRecord(row) : null
  }

  list(): UserRecord[] {
    return (this.db.prepare(`SELECT ${COLUMNS} FROM users ORDER BY username`).all() as unknown as UserRow[]).map(toRecord)
  }

  insert(
    user: { id: string; username: string; displayName: string; role: Role; passwordHash: string; mustChangePassword: boolean },
    nowIso: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO users (id, username, display_name, role, status, password_hash, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`
      )
      .run(user.id, user.username, user.displayName, user.role, user.passwordHash, user.mustChangePassword ? 1 : 0, nowIso, nowIso)
  }

  update(id: string, fields: Partial<UserRecord>, nowIso: string): void {
    const entries = Object.entries(fields).filter(([key]) => key in FIELD_COLUMNS)
    if (entries.length === 0) return
    const sets = entries.map(([key]) => `${FIELD_COLUMNS[key]} = ?`).join(', ')
    const values = entries.map(([, value]) => (typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number | null)))
    this.db.prepare(`UPDATE users SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, nowIso, id)
  }
}
