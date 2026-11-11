import { rename, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { OverlayOptions, Sharp } from 'sharp'
import sharp from './sharpSetup'
import type { BackgroundRemoval, Compositor, StoredImage } from '../../core/capture/captureService'
import { applyChromaKey } from '../../shared/chroma'
import { guidedMatte } from './guidedMatte'
import { contactShadow, integratePerson } from './personIntegration'
import { refineMatte } from './refineMatte'
import { placeFrame, sanitizePlacement, type FramePlacement, type OutputSize, type PlannedLayer } from '../../shared/compositionPlan'

/** Densidad máxima al rasterizar SVG, para no generar imágenes intermedias enormes. */
const MAX_SVG_DENSITY = 2400

/** Recorte automático de la persona: máscara de un canal del tamaño de la imagen RGB. */
export interface PersonSegmenter {
  matte(rgb: Buffer, width: number, height: number): Promise<Buffer>
}

interface CompositorOptions {
  dataRoot: string
  contentDir: string
  output: OutputSize & { jpegQuality: number }
  segmenter?: PersonSegmenter | null
  /** Aviso cuando el recorte falla y la foto se compone completa. */
  onWarning?: (message: string, error: unknown) => void
}

/**
 * Composición local por capas con sharp (libvips), sin servicios externos (RF-CMP-001, RF-CMP-002).
 * El recorte de la persona puede ser por croma o automático (modelo local), según la configuración. Las transparencias PNG, WebP y SVG se conservan; las capas
 * se recortan a los bordes de la imagen y nada se deforma (RF-CMP-003).
 */
export class SharpCompositor implements Compositor {
  constructor(private readonly options: CompositorOptions) {}

  async compose(
    plan: PlannedLayer[],
    originalPath: string,
    outputPath: string,
    removal: BackgroundRemoval,
    framing = 1,
    frame: FramePlacement | null = null,
    backdrop = false
  ): Promise<StoredImage> {
    const { width, height, jpegQuality } = this.options.output
    const overlays: OverlayOptions[] = []
    const sceneLayer = plan.find((layer) => layer.kind === 'fill' && layer.resource.type === 'scenario')
    const sceneLuma = sceneLayer?.kind === 'fill' ? await this.averageLuminance(sceneLayer.resource.src) : undefined

    for (const layer of plan) {
      if (layer.kind === 'photo') {
        const person = await this.person(originalPath, layer.width, layer.height, removal, framing, frame, backdrop, sceneLuma)
        if (person.shadow) {
          overlays.push(...(await this.clip(person.shadow.input, layer.left + person.left + person.shadow.left, layer.top + person.top + person.shadow.top, person.shadow.width, person.shadow.height)))
        }
        overlays.push(...(await this.clip(person.input, layer.left + person.left, layer.top + person.top, person.width, person.height)))
      } else if (layer.kind === 'backdrop') {
        // Franjas de un escenario de otra proporción: él mismo ampliado, opaco y desenfocado.
        const input = await (await this.load(layer.resource.src, width))
          .resize(width, height, { fit: 'cover', position: 'centre' })
          .flatten({ background: '#ffffff' })
          .blur(Math.max(8, width / 30))
          .modulate({ brightness: 0.92 })
          .png()
          .toBuffer()
        overlays.push({ input, left: 0, top: 0 })
      } else if (layer.kind === 'fill' && layer.box) {
        // Escenario de otra proporción: completo, sin recortarlo.
        const w = Math.max(1, Math.round(layer.box.width * width))
        const h = Math.max(1, Math.round(layer.box.height * height))
        const input = await (await this.load(layer.resource.src, w)).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer()
        overlays.push(...(await this.clip(input, Math.round(layer.box.x * width), Math.round(layer.box.y * height), w, h)))
      } else if (layer.kind === 'fill') {
        const input = await (await this.load(layer.resource.src, width))
          .resize(width, height, { fit: 'cover', position: 'centre' })
          .png()
          .toBuffer()
        overlays.push({ input, left: 0, top: 0 })
      } else {
        const input = await (await this.load(layer.resource.src, layer.width))
          .resize(layer.width, layer.height, { fit: 'fill' })
          .png()
          .toBuffer()
        overlays.push(...(await this.clip(input, layer.left, layer.top, layer.width, layer.height)))
      }
    }

    const finalAbs = join(this.options.dataRoot, outputPath)
    const temp = `${finalAbs}.part`
    try {
      await sharp({ create: { width, height, channels: 3, background: '#000000' } })
        .composite(overlays)
        .jpeg({ quality: jpegQuality, chromaSubsampling: '4:4:4' })
        .toFile(temp)
      await rename(temp, finalAbs)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }

    return { filePath: outputPath, format: 'jpeg', width, height, sizeBytes: (await stat(finalAbs)).size }
  }

  /**
   * La captura dentro de la zona de la persona, sin deformarse y según el encuadre (`placeFrame`), con
   * el fondo quitado según el método. Se recorta y redimensiona una sola vez desde la captura original
   * a resolución completa, para conservar su calidad; el recorte del fondo se hace sobre ese resultado,
   * más rápido que procesar la captura completa. Devuelve la imagen y su posición dentro de la zona.
   */
  private async person(
    originalPath: string,
    regionWidth: number,
    regionHeight: number,
    removal: BackgroundRemoval,
    framing: number,
    frame: FramePlacement | null,
    backdrop = false,
    sceneLuma?: number
  ): Promise<{ input: Buffer; left: number; top: number; width: number; height: number; shadow?: Awaited<ReturnType<typeof contactShadow>> }> {
    const source = sharp(join(this.options.dataRoot, originalPath)).rotate()
    const { width: frameWidth = regionWidth, height: frameHeight = regionHeight } = await source.clone().metadata()
    // El encuadre automático de la vista previa, si llegó; si no, el encuadre fijo configurado.
    const { crop, box } = (frame && sanitizePlacement(frame)) ?? placeFrame(frameWidth, frameHeight, regionWidth, regionHeight, framing)
    const extract = {
      left: Math.round(crop.x * frameWidth),
      top: Math.round(crop.y * frameHeight),
      width: Math.max(1, Math.min(frameWidth - Math.round(crop.x * frameWidth), Math.round(crop.width * frameWidth))),
      height: Math.max(1, Math.min(frameHeight - Math.round(crop.y * frameHeight), Math.round(crop.height * frameHeight)))
    }
    const width = Math.max(1, Math.round(box.width * regionWidth))
    const height = Math.max(1, Math.round(box.height * regionHeight))
    const place = { left: Math.round(box.x * regionWidth), top: Math.round(box.y * regionHeight), width, height }
    // Al reducir (cámara de más resolución que la zona), lanczos conserva el detalle. Al ampliar (cámara
    // HD), mitchell da una imagen limpia y natural: sin el enfoque artificial ni los halos de lanczos,
    // que resaltaban el grano y el ruido de la cámara.
    const upscaling = width > extract.width * 1.05
    const resized = source.extract(extract).resize(width, height, { fit: 'fill', kernel: upscaling ? 'mitchell' : 'lanczos3' })

    if (!removal) {
      const input = await resized.toBuffer()
      const covered = place.left <= 0 && place.top <= 0 && place.width >= regionWidth && place.height >= regionHeight
      if (!backdrop || covered) return { ...place, input }
      // Zona transparente de un escenario: la foto sin zoom y, alrededor, la misma foto ampliada y
      // desenfocada, para que la zona quede llena sin recortar a la persona.
      const filled = await sharp(join(this.options.dataRoot, originalPath))
        .rotate()
        .resize(regionWidth, regionHeight, { fit: 'cover' })
        .blur(Math.max(8, regionWidth / 40))
        .modulate({ brightness: 0.85 })
        .composite([{ input, left: place.left, top: place.top }])
        .png()
        .toBuffer()
      return { input: filled, left: 0, top: 0, width: regionWidth, height: regionHeight }
    }

    if (removal.method === 'chroma') {
      const { data, info } = await resized.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      applyChromaKey(data, removal.chroma)
      return { ...place, input: await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer() }
    }

    const { data, info } = await resized.removeAlpha().raw().toBuffer({ resolveWithObject: true })
    try {
      if (!this.options.segmenter) throw new Error('Modelo de recorte no disponible')
      const fine = await this.options.segmenter.matte(data, info.width, info.height)
      const guided = removal.guide ? await guidedMatte(fine, removal.guide, info.width, info.height, crop) : fine
      // Bordes finos a resolución completa (cabello, brazos) y sin halos del fondo.
      const alpha = refineMatte(guided, data, info.width, info.height)
      const integrated = integratePerson(data, alpha, info.width, info.height, sceneLuma)
      const input = await sharp(integrated, { raw: { width: info.width, height: info.height, channels: 3 } })
        .joinChannel(alpha, { raw: { width: info.width, height: info.height, channels: 1 } })
        .png()
        .toBuffer()
      const shadow = sceneLuma === undefined ? null : await contactShadow(alpha, info.width, info.height)
      return { ...place, input, ...(shadow ? { shadow } : {}) }
    } catch (error) {
      // Mejor una foto con su fondo que ninguna foto: se compone completa y se avisa.
      this.options.onWarning?.('segmentation_failed', error)
      return { ...place, input: await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer() }
    }
  }

  /** Luminancia media reducida del escenario para una igualación global muy moderada. */
  private async averageLuminance(relativePath: string): Promise<number | undefined> {
    try {
      const { data, info } = await (await this.load(relativePath, 1)).resize(1, 1).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      if (info.channels < 3) return undefined
      return (0.2126 * data[0]! + 0.7152 * data[1]! + 0.0722 * data[2]!) / 255
    } catch {
      return undefined
    }
  }

  /** Carga un recurso; los SVG se rasterizan a la densidad necesaria para el ancho final, sin pixelado. */
  private async load(relativePath: string, targetWidth: number): Promise<Sharp> {
    const file = join(this.options.contentDir, relativePath)
    if (extname(file).toLowerCase() !== '.svg') return sharp(file)
    const { width } = await sharp(file).metadata()
    const density = width ? Math.min(MAX_SVG_DENSITY, Math.max(72, Math.ceil((72 * targetWidth) / width))) : 72
    return sharp(file, { density })
  }

  /** Recorta la capa a la parte visible dentro de la imagen final; sharp no admite capas que excedan el lienzo. */
  private async clip(input: Buffer, left: number, top: number, w: number, h: number): Promise<OverlayOptions[]> {
    const { width, height } = this.options.output
    const x0 = Math.max(0, left)
    const y0 = Math.max(0, top)
    const x1 = Math.min(width, left + w)
    const y1 = Math.min(height, top + h)
    if (x1 <= x0 || y1 <= y0) return []
    if (x0 === left && y0 === top && x1 === left + w && y1 === top + h) return [{ input, left, top }]
    const cropped = await sharp(input)
      .extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 })
      .toBuffer()
    return [{ input: cropped, left: x0, top: y0 }]
  }
}
