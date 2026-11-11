import { z } from 'zod'
import { attractSettingsSchema, type AttractSettings } from './attract'
import { characterAnimationSchema, characterSlotSchema, entryDirectionSchema, freePlacementSchema, photoRegionSchema, selectionModeSchema, type CharacterAnimation, type EntryDirection } from './campaign'
import { cameraControlsSchema } from './cameraControls'
import type { FractionRect } from './compositionPlan'
import { BACKGROUND_METHODS, chromaSchema } from './chroma'
import { settingsSchema } from './settings'
import type { ConnectivityState } from './publication'

/** Roles mínimos (RF-AUT-006). La matriz definitiva está pendiente de aprobación (PD-009). */
export const ROLES = ['content', 'operator', 'sysadmin'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  content: 'Administrador de contenido',
  operator: 'Operador / soporte',
  sysadmin: 'Administrador del sistema'
}

export type Permission =
  | 'dashboard.view'
  | 'campaigns.manage'
  | 'media.manage'
  | 'users.manage'
  | 'settings.publication'
  | 'settings.chroma'
  | 'settings.general'
  | 'kiosk.exit'
  /** Consultar participaciones y fotografías sin datos personales (RF-PAR-001, RF-FOT-001). */
  | 'participations.view'
  /** Ver nombres y DNI y buscar por DNI (RF-PAR-002, RN-008). */
  | 'participations.personal'
  /** Ejecutar solicitudes de eliminación de datos (RF-PAR-005). */
  | 'participations.delete'
  | 'publication.retry'
  | 'reports.export'
  /** Bitácora completa; sin este permiso solo se ve la de contenido (vista limitada). */
  | 'audit.view'
  | 'audit.viewContent'
  | 'maintenance.backup'

/** Matriz inicial de permisos (sección 14), provisional hasta aprobar PD-009. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  content: ['dashboard.view', 'campaigns.manage', 'media.manage', 'participations.view', 'reports.export', 'audit.viewContent'],
  operator: [
    'dashboard.view',
    'settings.chroma',
    'kiosk.exit',
    'participations.view',
    'publication.retry',
    'reports.export',
    'audit.view',
    'audit.viewContent',
    'maintenance.backup'
  ],
  sysadmin: [
    'dashboard.view',
    'campaigns.manage',
    'media.manage',
    'users.manage',
    'settings.publication',
    'settings.chroma',
    'settings.general',
    'kiosk.exit',
    'participations.view',
    'participations.personal',
    'participations.delete',
    'publication.retry',
    'reports.export',
    'audit.view',
    'audit.viewContent',
    'maintenance.backup'
  ]
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

/** Política provisional de contraseñas (RF-AUT-002). */
export const PASSWORD_MIN_LENGTH = 10

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return 'Debe combinar letras y números'
  return null
}

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'El usuario debe tener al menos 3 caracteres')
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Use letras sin tilde, números, punto, guion o guion bajo')
export const passwordSchema = z.string().max(200).superRefine((value, ctx) => {
  const problem = passwordProblem(value)
  if (problem) ctx.addIssue({ code: 'custom', message: problem })
})
const displayNameSchema = z.string().trim().min(2, 'Ingrese un nombre').max(80)
const id = z.string().min(1).max(64)
const isoDate = z.iso.datetime().nullable()

export const setupSchema = z.object({ username: usernameSchema, displayName: displayNameSchema, password: passwordSchema })
export const loginSchema = z.object({ username: z.string().max(80), password: z.string().max(200) })

export interface AdminStatus {
  /** No hay usuarios: se debe crear la cuenta administrativa inicial (RF-USR-002). */
  setupRequired: boolean
}

export interface AdminUser {
  id: string
  username: string
  displayName: string
  role: Role
  mustChangePassword: boolean
}

export type LoginResult =
  | { ok: true; token: string; user: AdminUser }
  | { ok: false; error: 'invalid_credentials' | 'locked' | 'setup_required'; retryAfterSeconds?: number }

export type SetupResult = LoginResult | { ok: false; error: 'invalid_input'; message: string }

export const PHOTO_STATES = ['none', 'captured', 'composed', 'pending', 'published', 'failed', 'expired', 'deleted'] as const
export const PARTICIPATION_STATES = ['registered', 'captured', 'composed', 'completed', 'cancelled', 'failed', 'anonymized'] as const

/** Filtros de participaciones y reportes (RF-PAR-002, RF-REP-001). Las fechas son instantes ISO. */
export const participationFilters = z.object({
  from: z.iso.datetime().nullable().default(null),
  to: z.iso.datetime().nullable().default(null),
  campaignId: z.string().max(64).nullable().default(null),
  status: z.enum(PARTICIPATION_STATES).nullable().default(null),
  photoStatus: z.enum(PHOTO_STATES).nullable().default(null),
  /** Solo para roles con acceso a datos personales. */
  dni: z.string().regex(/^\d{8}$/, 'El DNI debe tener 8 dígitos').nullable().default(null)
})
export type ParticipationFilters = z.infer<typeof participationFilters>

export const auditFilters = z.object({
  from: z.iso.datetime().nullable().default(null),
  to: z.iso.datetime().nullable().default(null),
  level: z.enum(['debug', 'info', 'warn', 'error']).nullable().default(null),
  category: z.string().max(40).nullable().default(null),
  result: z.enum(['ok', 'fail', 'denied', 'skipped']).nullable().default(null)
})
export type AuditFilters = z.infer<typeof auditFilters>

export const PAGE_SIZE = 25

/** Operaciones del panel: nombre → esquema de entrada. Cada una exige un permiso (adminApi.ts). */
export const adminInputs = {
  'session.me': z.object({}),
  'session.changePassword': z.object({ current: z.string().max(200), next: passwordSchema }),
  'session.logout': z.object({}),

  'dashboard.get': z.object({}),

  'campaigns.list': z.object({}),
  'campaigns.get': z.object({ id }),
  'campaigns.create': z.object({ name: z.string().trim().min(2).max(120) }),
  'campaigns.update': z.object({
    id,
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(300),
    startsAt: isoDate,
    endsAt: isoDate,
    characterMode: selectionModeSchema,
    frameMode: selectionModeSchema,
    allowCameraBackground: z.boolean()
  }),
  'campaigns.setStatus': z.object({ id, status: z.enum(['active', 'inactive', 'archived']) }),
  'campaigns.setImage': z.object({ id }),
  'campaigns.saveLayout': z.object({
    id,
    photo: photoRegionSchema,
    characterSlots: z.array(characterSlotSchema).min(1).max(3),
    /** Si se omite, se conserva la configuración actual. */
    freePlacement: freePlacementSchema.optional(),
    characterAnimation: characterAnimationSchema.optional(),
    overlays: z.array(z.object({ resourceId: id, x: z.number().min(-0.5).max(1), y: z.number().min(-0.5).max(1), scale: z.number().gt(0).max(1) })).max(10)
  }),
  'resources.add': z.object({
    campaignId: id,
    type: z.enum(['scenario', 'character', 'frame', 'logo']),
    /** Para personajes: escenarios en los que se ofrece. */
    scenarioIds: z.array(id).max(50).default([])
  }),
  'resources.update': z.object({
    campaignId: id,
    resourceId: id,
    name: z.string().trim().min(1).max(120),
    active: z.boolean(),
    scenarioIds: z.array(id).max(50).optional()
  }),
  'resources.setAnimation': z.object({ campaignId: id, resourceId: id }),
  'resources.clearAnimation': z.object({ campaignId: id, resourceId: id }),
  'resources.updateMotion': z.object({
    campaignId: id,
    resourceId: id,
    entryDirection: entryDirectionSchema,
    anchorX: z.number().min(0).max(1),
    anchorY: z.number().min(0).max(1)
  }),
  'resources.move': z.object({ campaignId: id, resourceId: id, direction: z.enum(['up', 'down']) }),
  'resources.remove': z.object({ campaignId: id, resourceId: id }),

  'media.list': z.object({}),
  'media.add': z.object({}),
  'media.update': z.object({
    id,
    name: z.string().trim().min(1).max(120),
    active: z.boolean(),
    displaySeconds: z.int().min(2).max(120).nullable()
  }),
  'media.move': z.object({ id, direction: z.enum(['up', 'down']) }),
  'media.remove': z.object({ id }),
  'attract.get': z.object({}),
  'attract.save': attractSettingsSchema.omit({ logoPath: true, backgroundPath: true }),
  'attract.setImage': z.object({ kind: z.enum(['logo', 'background']) }),
  'attract.clearImage': z.object({ kind: z.enum(['logo', 'background']) }),

  'users.list': z.object({}),
  'users.create': z.object({ username: usernameSchema, displayName: displayNameSchema, role: z.enum(ROLES), password: passwordSchema }),
  'users.update': z.object({ id, displayName: displayNameSchema, role: z.enum(ROLES), active: z.boolean() }),
  'users.resetPassword': z.object({ id, password: passwordSchema }),

  'settings.getPublication': z.object({}),
  'settings.savePublication': z.object({
    baseUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]),
    /** Vacío conserva la clave actual; nunca se devuelve la clave guardada (RF-CFG-002). */
    secret: z.string().max(200)
  }),
  'settings.testPublication': z.object({}),
  'settings.getBackground': z.object({}),
  'settings.saveBackground': z.object({ method: z.enum(BACKGROUND_METHODS), chroma: chromaSchema, cameraControls: cameraControlsSchema.catch({}) }),

  'system.quit': z.object({}),

  'participations.list': participationFilters.extend({ page: z.int().min(1).default(1) }),
  'participations.get': z.object({ id }),
  'participations.photo': z.object({ photoId: id }),
  'participations.delete': z.object({ id, reason: z.string().trim().min(3, 'Indique el motivo o la referencia de la solicitud').max(300) }),
  'publication.retry': z.object({ photoId: id }),

  'reports.participations': participationFilters,
  'reports.summary': participationFilters,
  'reports.audit': auditFilters,

  'audit.list': auditFilters.extend({ page: z.int().min(1).default(1) }),

  'settings.getGeneral': z.object({}),
  'settings.saveGeneral': settingsSchema,
  'settings.exportConfig': z.object({}),
  'settings.importConfig': z.object({}),

  'maintenance.status': z.object({}),
  'maintenance.backup': z.object({ includePhotos: z.boolean() }),
  'maintenance.runRetention': z.object({})
} as const

export type AdminMethod = keyof typeof adminInputs
export type AdminInput<M extends AdminMethod> = z.input<(typeof adminInputs)[M]>

export type AdminResult<T> = { ok: true; data: T } | { ok: false; error: string; message: string }

// ----- Datos devueltos por el panel -----

export interface DashboardData {
  generatedAt: string
  participationsToday: number
  completedToday: number
  participationsTotal: number
  activeCampaigns: number
  availableCampaigns: number
  connectivity: ConnectivityState
  pendingPublications: number
  failedPublications: number
  freeDiskMb: number | null
  warnFreeMb: number
  errorsLast24h: number
  lastCameraProblemAt: string | null
  alerts: string[]
}

export interface CampaignListItem {
  id: string
  code: string
  name: string
  status: 'draft' | 'active' | 'inactive' | 'archived'
  startsAt: string | null
  endsAt: string | null
  scenarios: number
  participations: number
  problems: string[]
}

export interface AdminResource {
  id: string
  type: 'scenario' | 'character' | 'frame' | 'logo' | 'other'
  name: string
  imageUrl: string
  /** WebM transparente opcional para la vista previa del personaje. */
  animationUrl: string | null
  animationDurationMs: number | null
  animationBackground: 'alpha' | 'chroma' | 'segmentation'
  width: number
  height: number
  active: boolean
  sortOrder: number
  layer: number
  x: number
  y: number
  scale: number
  /** Personajes: escenarios en los que se ofrece. */
  scenarioIds: string[]
  /** Escenarios: zona transparente detectada, donde irá la foto en lugar de la zona de la campaña. */
  photoHole: FractionRect | null
  entryDirection: EntryDirection
  contentBounds: FractionRect
  anchorX: number
  anchorY: number
}

export interface AdminCampaign {
  id: string
  code: string
  name: string
  description: string
  status: CampaignListItem['status']
  startsAt: string | null
  endsAt: string | null
  imageUrl: string | null
  characterMode: z.infer<typeof selectionModeSchema>
  frameMode: z.infer<typeof selectionModeSchema>
  allowCameraBackground: boolean
  photo: z.infer<typeof photoRegionSchema>
  characterSlots: z.infer<typeof characterSlotSchema>[]
  freePlacement: z.infer<typeof freePlacementSchema>
  characterAnimation: CharacterAnimation
  resources: AdminResource[]
  /** Problemas que impiden activarla, en lenguaje claro (RF-CAM-003). */
  problems: string[]
  participations: number
}

/** Pantalla principal en el panel: la configuración guardada y la URL de sus imágenes. */
export interface AdminAttract extends AttractSettings {
  logoUrl: string | null
  backgroundUrl: string | null
}

export interface AdminMedia {
  id: string
  type: 'image' | 'video'
  name: string
  url: string
  active: boolean
  displaySeconds: number | null
  sortOrder: number
  fileMissing: boolean
}

export interface AdminUserRow extends AdminUser {
  active: boolean
  lastLoginAt: string | null
  locked: boolean
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface ParticipationRow {
  id: string
  campaignName: string
  status: (typeof PARTICIPATION_STATES)[number]
  photoStatus: (typeof PHOTO_STATES)[number]
  startedAt: string
  finishedAt: string | null
  /** Solo con permiso de datos personales; si no, `null`. */
  fullName: string | null
  dni: string | null
}

export interface ParticipationPage extends Page<ParticipationRow> {
  campaigns: { id: string; name: string }[]
  /** Si quien consulta puede ver nombres y DNI y buscar por DNI. */
  personal: boolean
}

export interface ParticipationDetail extends ParticipationRow {
  campaignId: string
  confirmedAt: string | null
  selections: { scenario: string | null; characters: string[]; frame: string | null }
  consents: { title: string; type: string; version: string; accepted: boolean; recordedAt: string }[]
  photos: {
    id: string
    kind: 'original' | 'final'
    status: string
    width: number | null
    height: number | null
    createdAt: string
    publishedAt: string | null
    expiresAt: string | null
    /** Solo el inicio del token; nunca el token completo (RF-PAR-003). */
    tokenHint: string | null
    queue: { status: string; attempts: number; lastError: string | null } | null
  }[]
}

export interface DeletionResult {
  localPhotosDeleted: number
  remoteDeleted: number
  remotePending: number
}

export interface SummaryRow {
  campaignName: string
  day: string
  participations: number
  completed: number
  cancelled: number
  published: number
  pendingOrFailed: number
}

export interface ExportResult {
  saved: boolean
  rows: number
  fileName: string | null
}

export interface AuditRow {
  id: number
  occurredAt: string
  level: string
  category: string
  action: string
  result: string
  actor: string | null
  entity: string | null
  detail: string | null
}

export interface MaintenanceStatus {
  dataRoot: string
  databaseMb: number
  contentMb: number
  photosMb: number
  logsMb: number
  freeDiskMb: number | null
  retention: { enabled: boolean; photoDays: number; personalDataDays: number }
  /** Lo que eliminaría la política de conservación hoy (vista previa). */
  retentionPreview: { photos: number; participations: number }
  lastBackupAt: string | null
}

export interface PublicationSettingsView {
  baseUrl: string
  secretConfigured: boolean
  /** En desarrollo, el servicio local de `npm run publicador` tiene prioridad. */
  devOverride: string | null
  /** URL del servicio incluido en el instalador (con su clave), usado si no se configura otro. */
  builtInUrl: string | null
}
