import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/** Copia visual de la cámara: el cuadro congelado no se utiliza para guardar la foto. */
export function BufferedVideo({ videoRef, mirror, frozen }: { videoRef: RefObject<HTMLVideoElement | null>; mirror: boolean; frozen: boolean }): React.JSX.Element {
  const video = useRef<HTMLVideoElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const source = videoRef.current
    if (!source || !video.current || frozen) return
    if (source.srcObject) video.current.srcObject = source.srcObject
    else video.current.src = source.currentSrc || source.src
  }, [videoRef, frozen])
  useLayoutEffect(() => {
    const source = videoRef.current
    const target = canvas.current
    if (!frozen || !source?.videoWidth || !target) return
    const scale = Math.min(1, 1280 / Math.max(source.videoWidth, source.videoHeight))
    target.width = Math.round(source.videoWidth * scale)
    target.height = Math.round(source.videoHeight * scale)
    target.getContext('2d')?.drawImage(source, 0, 0, target.width, target.height)
  }, [videoRef, frozen])
  const className = `chroma-video${mirror ? ' mirrored' : ''}`
  return <>
    <video ref={video} autoPlay muted playsInline className={className} style={frozen ? { display: 'none' } : undefined} />
    <canvas ref={canvas} className={className} style={frozen ? undefined : { display: 'none' }} />
  </>
}
