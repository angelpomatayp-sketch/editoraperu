import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

// Conversión de formato únicamente: conserva la transparencia del PNG aprobado.
const input = resolve(process.argv[2] ?? 'resources/icon.png')
const output = resolve(process.argv[3] ?? 'resources/icon.ico')
const sizes = [16, 24, 32, 48, 64, 128, 256]
const source = await readFile(input)
const frames = await Promise.all(sizes.map(size => sharp(source).resize(size, size, { fit: 'contain', background: '#00000000' }).png().toBuffer()))
const header = Buffer.alloc(6 + sizes.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16
  header[entry] = sizes[i] === 256 ? 0 : sizes[i]
  header[entry + 1] = header[entry]
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(frames[i].length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += frames[i].length
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, Buffer.concat([header, ...frames]))
console.log(`Icono creado: ${output} (${sizes.join(', ')} px)`)
