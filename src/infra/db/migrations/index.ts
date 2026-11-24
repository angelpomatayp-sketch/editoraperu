import type { Migration } from '../migrator'
import { migration001 } from './001_initial'
import { migration002 } from './002_scenario_characters'
import { migration003 } from './003_scenario_photo_hole'
import { migration004 } from './004_character_animation'
import { migration005 } from './005_character_motion'
import { migration006 } from './006_animation_duration'
import { migration007 } from './007_video_background'
import { migration008 } from './008_pose_countdown'
import { migration009 } from './009_pose_countdown'
import { migration010 } from './010_delivery_retention'

/** Migraciones en orden. Nunca modificar una ya publicada: agregar una nueva. */
export const MIGRATIONS: Migration[] = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009, migration010]
