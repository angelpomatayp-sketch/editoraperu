import { readFileSync } from 'node:fs'
import { verifyPublicationBuild } from './verify-publication-build.mjs'

verifyPublicationBuild(readFileSync(new URL('../out/main/index.js', import.meta.url), 'utf8'))
console.log('Publicador de producción incluido en la compilación: verificado.')
