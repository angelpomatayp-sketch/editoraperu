import { existsSync } from 'node:fs'
import type { InferenceSession } from 'onnxruntime-node'
import sharp from './sharpSetup'

/**
 * ONNX Runtime se carga recién al usarse: si su biblioteca nativa no pudiera cargarse en un equipo,
 * la aplicación igual arranca, el error queda en la bitácora y la foto se compone sin recorte.
 */
const loadOrt = () => import('onnxruntime-node')

/**
 * Lado corto de la máscara final. 1280 mejora el contorno en capturas 4K, sin ejecutar la inferencia
 * sobre los 8,3 MP completos; la máscara resultante luego se refina a resolución de salida.
 */
const REFERENCE_SIDE = 1280

/**
 * Recorte automático de la persona con MODNet (Apache 2.0), ejecutado localmente con ONNX Runtime.
 * No genera ni modifica la imagen: solo calcula, píxel por píxel, cuánto pertenece a la persona.
 * La fotografía nunca sale del equipo.
 */
export class ModnetSegmenter {
  private session: Promise<InferenceSession> | null = null

  constructor(private readonly modelPath: string) {}

  available(): boolean {
    return existsSync(this.modelPath)
  }

  /** Carga el modelo por adelantado, para que la primera fotografía no espere la carga. */
  async dispose(): Promise<void> {
    const session = this.session
    this.session = null
    if (session) await (await session).release()
  }

  async warmUp(): Promise<void> {
    await this.matte(Buffer.alloc(64 * 64 * 3, 128), 64, 64)
  }

  /**
   * Devuelve la máscara de la persona (un canal, 0 = fondo, 255 = persona) del tamaño de la imagen
   * RGB recibida.
   */
  async matte(rgb: Buffer, width: number, height: number): Promise<Buffer> {
    const ort = await loadOrt()
    this.session ??= ort.InferenceSession.create(this.modelPath, { graphOptimizationLevel: 'all' })
    this.session.catch(() => {
      this.session = null
    })
    const session = await this.session

    // El lado corto usa la referencia de alta calidad y ambas dimensiones son múltiplos de 32,
    // como exige el modelo.
    const scale = REFERENCE_SIDE / Math.min(width, height)
    const inputWidth = Math.max(32, Math.round((width * scale) / 32) * 32)
    const inputHeight = Math.max(32, Math.round((height * scale) / 32) * 32)
    const resized = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .resize(inputWidth, inputHeight, { fit: 'fill' })
      .raw()
      .toBuffer()

    // De RGB intercalado a tensor CHW normalizado a [-1, 1].
    const plane = inputWidth * inputHeight
    const input = new Float32Array(3 * plane)
    for (let i = 0; i < plane; i++) {
      input[i] = resized[i * 3]! / 127.5 - 1
      input[plane + i] = resized[i * 3 + 1]! / 127.5 - 1
      input[2 * plane + i] = resized[i * 3 + 2]! / 127.5 - 1
    }

    const output = await session.run({ input: new ort.Tensor('float32', input, [1, 3, inputHeight, inputWidth]) })
    const matte = output['output']!.data as Float32Array
    const alpha = Buffer.alloc(plane)
    for (let i = 0; i < plane; i++) alpha[i] = Math.round(Math.min(1, Math.max(0, matte[i]!)) * 255)

    // sharp entrega 3 canales al redimensionar una imagen de 1 canal; se conserva solo uno.
    return sharp(alpha, { raw: { width: inputWidth, height: inputHeight, channels: 1 } })
      .resize(width, height, { fit: 'fill', kernel: 'cubic' })
      .extractChannel(0)
      .raw()
      .toBuffer()
  }
}
