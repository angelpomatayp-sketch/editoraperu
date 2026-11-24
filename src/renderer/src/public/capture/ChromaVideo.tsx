import { useEffect, useRef, useState, type RefObject } from 'react'
import { chromaOf, hexToRgb, type ChromaSettings } from '../../../../shared/chroma'
import { BufferedVideo } from './BufferedVideo'

interface ChromaVideoProps {
  frozen?: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  chroma: ChromaSettings
  mirror: boolean
  /** `rgb` permite quitar fondos neutros como blanco; el croma normal compara color sin luminancia. */
  mode?: 'chroma' | 'rgb'
  characterEdges?: boolean
}

const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`

// Mismo cálculo que `applyChromaKey` (src/shared/chroma.ts), para que la vista previa coincida con el resultado.
const FRAGMENT = `
precision mediump float;
uniform sampler2D u_video;
uniform vec2 u_scale;
uniform vec2 u_offset;
uniform bool u_mirror;
uniform vec2 u_key;
uniform vec3 u_rgb_key;
uniform bool u_rgb_mode;
uniform float u_similarity;
uniform float u_smoothness;
uniform float u_spill;
uniform bool u_character_edges;
varying vec2 v_uv;

void main() {
  vec2 uv = v_uv * u_scale + u_offset;
  if (u_mirror) uv.x = 1.0 - uv.x;
  vec4 color = texture2D(u_video, vec2(uv.x, 1.0 - uv.y));
  vec3 c = color.rgb;
  float cb = -0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b + 0.5;
  float cr = 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b + 0.5;
  float key_distance = u_rgb_mode ? distance(c, u_rgb_key) : distance(vec2(cb, cr), u_key);
  float alpha = clamp((key_distance - u_similarity) / u_smoothness, 0.0, 1.0);
  float limit = max(c.r, c.b);
  if (!u_rgb_mode && c.g <= limit) alpha = 1.0;
  if (!u_rgb_mode && c.g > limit) color.g = limit + (c.g - limit) * (1.0 - u_spill);
  // Solo personajes: quitar el tinte amarillo-verde de la transición, sin cambiar su silueta.
  if (u_character_edges && !u_rgb_mode && alpha < 1.0 && c.g > limit + 0.008) color.g = (c.r + c.b) * 0.5;
  alpha *= color.a;
  gl_FragColor = vec4(color.rgb * alpha, alpha);
}`

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader')
  return shader
}

/**
 * Cámara en vivo con el fondo verde recortado (vista previa del croma), ajustada para cubrir su zona
 * sin deformarse. Si WebGL no está disponible, se muestra el video sin recortar.
 */
export function ChromaVideo({ videoRef, chroma, mirror, mode = 'chroma', characterEdges = false, frozen = false }: ChromaVideoProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [fallback, setFallback] = useState(false)
  const frozenRef = useRef(frozen)
  frozenRef.current = frozen

  useEffect(() => {
    const canvas = canvasRef.current
    const gl = canvas?.getContext('webgl', { premultipliedAlpha: true, alpha: true })
    if (!canvas || !gl) {
      setFallback(true)
      return
    }

    let program: WebGLProgram
    try {
      program = gl.createProgram()!
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
      gl.linkProgram(program)
      gl.useProgram(program)
    } catch {
      setFallback(true)
      return
    }

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)

    const uniform = (name: string) => gl.getUniformLocation(program, name)
    const [kr, kg, kb] = hexToRgb(chroma.keyColor)
    gl.uniform2fv(uniform('u_key'), chromaOf(kr, kg, kb))
    gl.uniform3f(uniform('u_rgb_key'), kr / 255, kg / 255, kb / 255)
    gl.uniform1i(uniform('u_rgb_mode'), mode === 'rgb' ? 1 : 0)
    gl.uniform1f(uniform('u_similarity'), chroma.similarity)
    gl.uniform1f(uniform('u_smoothness'), chroma.smoothness)
    gl.uniform1f(uniform('u_spill'), chroma.spill)
    gl.uniform1i(uniform('u_character_edges'), characterEdges ? 1 : 0)
    gl.uniform1i(uniform('u_mirror'), mirror ? 1 : 0)

    let frame = 0
    let videoWidth = 0
    let videoHeight = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const video = videoRef.current
      if (!video) return
      if (!frozenRef.current) {
        if (video.readyState < 2 || !video.videoWidth) return
        videoWidth = video.videoWidth
        videoHeight = video.videoHeight
      }
      if (!videoWidth || !videoHeight) return

      const width = canvas.clientWidth * devicePixelRatio
      const height = canvas.clientHeight * devicePixelRatio
      if (canvas.width !== Math.round(width) || canvas.height !== Math.round(height)) {
        canvas.width = Math.round(width)
        canvas.height = Math.round(height)
        gl.viewport(0, 0, canvas.width, canvas.height)
      }

      // Recorte centrado equivalente a `object-fit: cover` y al `fit: cover` de la composición final.
      const videoAspect = videoWidth / videoHeight
      const canvasAspect = canvas.width / canvas.height
      const scale = videoAspect > canvasAspect ? [canvasAspect / videoAspect, 1] : [1, videoAspect / canvasAspect]
      gl.uniform2f(uniform('u_scale'), scale[0]!, scale[1]!)
      gl.uniform2f(uniform('u_offset'), (1 - scale[0]!) / 2, (1 - scale[1]!) / 2)

      // Conservar la textura del último cuadro, incluso después de apagar la cámara.
      if (!frozenRef.current) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    draw()

    return () => {
      cancelAnimationFrame(frame)
      gl.deleteTexture(texture)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [videoRef, chroma, mirror, mode, characterEdges])

  if (fallback) {
    return <BufferedVideo videoRef={videoRef} mirror={mirror} frozen={frozen} />
  }
  return <canvas ref={canvasRef} className="chroma-video" />
}
