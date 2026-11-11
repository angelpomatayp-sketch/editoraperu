let context: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    context ??= new AudioContext()
    return context
  } catch {
    return null
  }
}

/** Señal breve de la cuenta regresiva (RF-CAP-004). */
export function beep(frequency = 880, seconds = 0.12): void {
  const ctx = audio()
  if (!ctx) return
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.frequency.value = frequency
  gain.gain.setValueAtTime(0.25, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds)
  oscillator.connect(gain).connect(ctx.destination)
  oscillator.start()
  oscillator.stop(ctx.currentTime + seconds)
}

/** Sonido de obturador: un golpe de ruido corto. */
export function shutter(): void {
  const ctx = audio()
  if (!ctx) return
  const length = Math.floor(ctx.sampleRate * 0.15)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3
  const source = ctx.createBufferSource()
  const gain = ctx.createGain()
  gain.gain.value = 0.4
  source.buffer = buffer
  source.connect(gain).connect(ctx.destination)
  source.start()
}
