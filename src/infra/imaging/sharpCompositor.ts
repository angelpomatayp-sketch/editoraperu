import { rename, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { OverlayOptions, Sharp } from 'sharp'
import sharp from './sharpSetup'
import type { BackgroundRemoval, Compositor, StoredImage } from '../../core/capture/captureService'
import { applyChromaKey } from '../../shared/chroma'
import { guidedMatte } from './guidedMatte'
import { applySceneColorGrade, contactShadow, integratePerson, type PhotoTone, type SceneColorProfile } from './personIntegration'
import { refineMatte } from './refineMatte'
import { placeFrame, sanitizePlacement, type FramePlacement, type OutputSize, type PlannedLayer } from '../../shared/compositionPlan'

/** Densidad máxima al rasterizar SVG, para no generar imágenes intermedias enormes. */
const MAX_SVG_DENSITY = 2400

/** Recorte automático de la persona: máscara de un canal del tamaño de la imagen RGB. */
export interface PersonSegmenter {
  readonly independentMatte?: boolean
  matte(rgb: Buffer, width: number, height: number): Promise<Buffer>
}

export interface CompositorOptions {
  dataRoot: string
  contentDir: string
  output: OutputSize & { jpegQuality: number }
  segmenter?: PersonSegmenter | null
  /** Aviso cuando el recorte falla y la foto se compone completa. */
  onWarning?: (message: string, error: unknown) => void
  onTiming?: (stage: string, milliseconds: number) => void
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
      backdrop = false,
      levelToCharacter = false,
      advancedSceneColor = false
  ): Promise<StoredImage> {
    const { width, height, jpegQuality } = this.options.output
    const overlays: OverlayOptions[] = []
    const sceneLayer = plan.find((layer) => layer.kind === 'fill' && layer.resource.type === 'scenario')
    const characterPaths = plan.flatMap((layer) => layer.kind === 'placed' && layer.resource.type === 'character' ? [layer.resource.src] : [])
    const referenceTone = removal?.matchSceneTone
        ? await this.referenceTone(sceneLayer?.kind === 'fill' ? sceneLayer.resource.src : undefined, characterPaths)
        : undefined

    // Filtro avanzado de color: perfil de luz y ambiente de la escena (sustituye a la corrección básica).
    const advancedProfile = advancedSceneColor && removal
        ? await this.sceneColorProfile(sceneLayer?.kind === 'fill' ? sceneLayer.resource.src : undefined, characterPaths)
        : undefined

    // Nivelado automático: línea de apoyo del primer personaje, en fracciones de la zona de la persona.
    let levelBaseline: number | null = null
    if (levelToCharacter) {
      const photoLayer = plan.find((layer) => layer.kind === 'photo')
      const characterLayer = plan.find((layer) => layer.kind === 'placed' && layer.resource.type === 'character')
      if (photoLayer?.kind === 'photo' && characterLayer?.kind === 'placed' && photoLayer.height > 0) {
        const bottom = await this.visibleBottomFraction(characterLayer.resource.src)
        if (bottom !== null) {
          levelBaseline = (characterLayer.top + bottom * characterLayer.height - photoLayer.top) / photoLayer.height
        }
      }
    }

    for (const layer of plan) {
      if (layer.kind === 'photo') {
        const person = await this.person(originalPath, layer.width, layer.height, removal, framing, frame, backdrop, referenceTone, sceneLayer !== undefined, levelBaseline, advancedProfile)
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
          .png({ compressionLevel: 1 })
          .toBuffer()
        overlays.push({ input, left: 0, top: 0 })
      } else if (layer.kind === 'fill' && layer.box) {
        // Escenario de otra proporción: completo, sin recortarlo.
        const w = Math.max(1, Math.round(layer.box.width * width))
        const h = Math.max(1, Math.round(layer.box.height * height))
        const input = await (await this.load(layer.resource.src, w)).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png({ compressionLevel: 1 }).toBuffer()
        overlays.push(...(await this.clip(input, Math.round(layer.box.x * width), Math.round(layer.box.y * height), w, h)))
      } else if (layer.kind === 'fill') {
        const input = await (await this.load(layer.resource.src, width))
          .resize(width, height, { fit: 'cover', position: 'centre' })
          .png({ compressionLevel: 1 })
          .toBuffer()
        overlays.push({ input, left: 0, top: 0 })
      } else {
        const input = await (await this.load(layer.resource.src, layer.width))
          .resize(layer.width, layer.height, { fit: 'fill' })
          .png({ compressionLevel: 1 })
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
      referenceTone?: PhotoTone,
      hasScene = false,
      levelBaseline: number | null = null,
      advancedProfile?: SceneColorProfile
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
      // Intermedio sin pérdida: toBuffer() sobre JPEG heredaba calidad y submuestreo por defecto.
      // El único JPEG de esta composición debe ser el archivo final (95, 4:4:4).
      const input = await resized.png({ compressionLevel: 1 }).toBuffer()
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
        .png({ compressionLevel: 1 })
        .toBuffer()
      return { input: filled, left: 0, top: 0, width: regionWidth, height: regionHeight }
    }

    if (removal.method === 'chroma') {
      const { data, info } = await resized.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      applyChromaKey(data, removal.chroma)
      const pixels = info.width * info.height
      const rgb = Buffer.allocUnsafe(pixels * 3)
      const alpha = new Uint8Array(pixels)
      for (let i = 0; i < pixels; i++) {
        rgb[i * 3] = data[i * 4]!
        rgb[i * 3 + 1] = data[i * 4 + 1]!
        rgb[i * 3 + 2] = data[i * 4 + 2]!
        alpha[i] = data[i * 4 + 3]!
      }
      const integrated = integratePerson(rgb, alpha, info.width, info.height, advancedProfile ? undefined : referenceTone)
      const gradedChroma = advancedProfile ? applySceneColorGrade(integrated, alpha, info.width, info.height, advancedProfile) : integrated
      for (let i = 0; i < pixels; i++) {
        data[i * 4] = gradedChroma[i * 3]!
        data[i * 4 + 1] = gradedChroma[i * 3 + 1]!
        data[i * 4 + 2] = gradedChroma[i * 3 + 2]!
      }
      const leveledChroma = levelBaseline !== null ? this.levelPlacement(place, alpha, info.width, info.height, regionHeight, levelBaseline) : place
      return { ...leveledChroma, input: await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 1 }).toBuffer() }
    }

    const { data, info } = await resized.removeAlpha().raw().toBuffer({ resolveWithObject: true })
    try {
      if (!this.options.segmenter) throw new Error('Modelo de recorte no disponible')
      let started = performance.now()
      const fine = await this.options.segmenter.matte(data, info.width, info.height)
      this.options.onTiming?.('matte', performance.now() - started)
      const guided = removal.guide && !this.options.segmenter.independentMatte
        ? await guidedMatte(fine, removal.guide, info.width, info.height, crop) : fine
      // Bordes finos a resolución completa (cabello, brazos) y sin halos del fondo.
      started = performance.now()
      const alpha = refineMatte(guided, data, info.width, info.height)
      this.options.onTiming?.('refine', performance.now() - started)
      started = performance.now()
      const integrated = integratePerson(data, alpha, info.width, info.height, advancedProfile ? undefined : referenceTone)
      const graded = advancedProfile ? applySceneColorGrade(integrated, alpha, info.width, info.height, advancedProfile) : integrated
      this.options.onTiming?.('integration', performance.now() - started)
      const input = await sharp(graded, { raw: { width: info.width, height: info.height, channels: 3 } })
          .joinChannel(alpha, { raw: { width: info.width, height: info.height, channels: 1 } })
          .png({ compressionLevel: 1 })
          .toBuffer()
      const leveled = levelBaseline !== null ? this.levelPlacement(place, alpha, info.width, info.height, regionHeight, levelBaseline) : place
      const shadow = !hasScene ? null : await contactShadow(alpha, info.width, info.height)
      return { ...leveled, input, ...(shadow ? { shadow } : {}) }
    } catch (error) {
      // Mejor una foto con su fondo que ninguna foto: se compone completa y se avisa.
      this.options.onWarning?.('segmentation_failed', error)
      return { ...place, input: await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer() }
    }
  }

  /**
   * Desplaza verticalmente a la persona recortada para que su borde inferior visible (los pies) quede
   * en la línea de apoyo del personaje (`baseline`, fracción del alto de la zona). No escala ni recorta:
   * solo mueve la capa, con límites para no sacar los pies de la zona ni la cabeza por arriba.
   */
  private levelPlacement(
      place: { left: number; top: number; width: number; height: number },
      alpha: Uint8Array | Buffer,
      width: number,
      height: number,
      regionHeight: number,
      baseline: number
  ): { left: number; top: number; width: number; height: number } {
    let first = -1
    let last = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (alpha[y * width + x]! >= 16) {
          if (first < 0) first = y
          last = y
          break
        }
      }
    }
    if (last < 0 || !Number.isFinite(baseline)) return place
    const bottomFraction = (last + 1) / height
    const topFraction = first / height
    const desiredTop = baseline * regionHeight - bottomFraction * place.height
    const maxTop = regionHeight - bottomFraction * place.height
    const minTop = -topFraction * place.height
    const top = Math.round(Math.min(Math.max(desiredTop, minTop), maxTop))
    return { ...place, top }
  }

  /** Fracción del alto donde termina el contenido visible (alfa) de un recurso; `null` si no se puede medir. */
  private async visibleBottomFraction(relativePath: string): Promise<number | null> {
    try {
      const { data, info } = await (await this.load(relativePath, 64)).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      for (let y = info.height - 1; y >= 0; y--) {
        for (let x = 0; x < info.width; x++) {
          if (data[(y * info.width + x) * 4 + 3]! >= 16) return (y + 1) / info.height
        }
      }
      return null
    } catch {
      return null
    }
  }

  /** Estadísticas de color y luz de un recurso (64 px), ponderadas por su alfa. */
  private async colorStats(relativePath: string): Promise<SceneColorProfile | undefined> {
    try {
      const { data, info } = await (await this.load(relativePath, 64)).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let red = 0
      let green = 0
      let blue = 0
      let sat = 0
      let sum = 0
      let sumSq = 0
      let weight = 0
      let top = 0
      let topWeight = 0
      let bottom = 0
      let bottomWeight = 0
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const i = (y * info.width + x) * 4
          const a = data[i + 3]! / 255
          if (a <= 0.02) continue
          const r = data[i]! / 255
          const g = data[i + 1]! / 255
          const b = data[i + 2]! / 255
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
          red += r * a
          green += g * a
          blue += b * a
          const max = Math.max(r, g, b)
          sat += (max > 0 ? (max - Math.min(r, g, b)) / max : 0) * a
          sum += l * a
          sumSq += l * l * a
          weight += a
          if (y < info.height / 2) { top += l * a; topWeight += a } else { bottom += l * a; bottomWeight += a }
        }
      }
      if (weight === 0) return undefined
      const luminance = sum / weight
      return {
        red: red / weight,
        green: green / weight,
        blue: blue / weight,
        luminance,
        saturation: sat / weight,
        contrast: Math.sqrt(Math.max(0, sumSq / weight - luminance * luminance)),
        skyLight: topWeight > 0 && bottomWeight > 0 ? top / topWeight - bottom / bottomWeight : 0
      }
    } catch {
      return undefined
    }
  }

  /**
   * Perfil del filtro avanzado: el escenario domina (75 %) y los personajes aportan el 25 %.
   * La luz cenital solo se mide en el escenario; en los personajes (PNG transparentes) no aplica.
   */
  private async sceneColorProfile(scenePath: string | undefined, characterPaths: string[]): Promise<SceneColorProfile | undefined> {
    const [scene, ...characters] = await Promise.all([
      scenePath ? this.colorStats(scenePath) : Promise.resolve(undefined),
      ...characterPaths.map((path) => this.colorStats(path))
    ])
    const usable = characters.filter((c): c is SceneColorProfile => c !== undefined)
    const average = (pick: (p: SceneColorProfile) => number) => usable.reduce((s, p) => s + pick(p), 0) / usable.length
    const character = usable.length === 0 ? undefined : {
      red: average((p) => p.red),
      green: average((p) => p.green),
      blue: average((p) => p.blue),
      luminance: average((p) => p.luminance),
      saturation: average((p) => p.saturation),
      contrast: average((p) => p.contrast),
      skyLight: 0
    }
    if (!scene) return character
    if (!character) return scene
    const mix = (a: number, b: number) => a * 0.75 + b * 0.25
    return {
      red: mix(scene.red, character.red),
      green: mix(scene.green, character.green),
      blue: mix(scene.blue, character.blue),
      luminance: mix(scene.luminance, character.luminance),
      saturation: mix(scene.saturation, character.saturation),
      contrast: mix(scene.contrast, character.contrast),
      skyLight: scene.skyLight
    }
  }

  /** Color medio visible de un recurso; la transparencia no contamina la medición. */
  private async averageTone(relativePath: string): Promise<PhotoTone | undefined> {
    try {
      const { data, info } = await (await this.load(relativePath, 32)).resize(32, 32, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let red = 0
      let green = 0
      let blue = 0
      let weight = 0
      for (let i = 0; i < info.width * info.height; i++) {
        const alpha = data[i * 4 + 3]! / 255
        if (alpha <= 0.02) continue
        red += data[i * 4]! * alpha
        green += data[i * 4 + 1]! * alpha
        blue += data[i * 4 + 2]! * alpha
        weight += alpha
      }
      if (weight === 0) return undefined
      red /= weight
      green /= weight
      blue /= weight
      return {
        luminance: (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255,
        warmth: (red - blue) / 255
      }
    } catch {
      return undefined
    }
  }

  /**
   * El escenario domina la referencia y los personajes elegidos aportan hasta 25 % del acabado.
   * Sin escenario (fondo real), los personajes son la única referencia visual disponible.
   */
  private async referenceTone(scenePath: string | undefined, characterPaths: string[]): Promise<PhotoTone | undefined> {
    const [scene, ...characters] = await Promise.all([
      scenePath ? this.averageTone(scenePath) : Promise.resolve(undefined),
      ...characterPaths.map((path) => this.averageTone(path))
    ])
    const usableCharacters = characters.filter((tone): tone is PhotoTone => tone !== undefined)
    const character = usableCharacters.length === 0 ? undefined : {
      luminance: usableCharacters.reduce((sum, tone) => sum + tone.luminance, 0) / usableCharacters.length,
      warmth: usableCharacters.reduce((sum, tone) => sum + tone.warmth, 0) / usableCharacters.length
    }
    if (!scene) return character
    if (!character) return scene
    return {
      luminance: scene.luminance * 0.75 + character.luminance * 0.25,
      warmth: scene.warmth * 0.75 + character.warmth * 0.25
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
