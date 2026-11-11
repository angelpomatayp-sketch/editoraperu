/** Gráficos de prueba generados para desarrollo. No son material aprobado por Editora Perú. */

const FONT = 'Segoe UI, sans-serif'
const W = 1080
const H = 1920

function label(text: string, y: number, size: number, color = '#ffffff', opacity = 1): string {
  return `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="700" fill="${color}" opacity="${opacity}">${text}</text>`
}

/** Fondo de escenario a pantalla completa. */
export function scenarioSvg(name: string, top: string, bottom: string, shapes: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  ${shapes}
  ${label(name, 220, 72, '#ffffff', 0.9)}
  ${label('Escenario de prueba', 1860, 32, '#ffffff', 0.5)}
</svg>`
}

/** Personaje con fondo transparente. */
export function characterSvg(name: string, color: string, accent: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 1200" width="600" height="1200">
  <circle cx="300" cy="260" r="170" fill="${color}"/>
  <circle cx="240" cy="230" r="22" fill="#1b1b1b"/>
  <circle cx="360" cy="230" r="22" fill="#1b1b1b"/>
  <path d="M220 320 Q300 380 380 320" stroke="#1b1b1b" stroke-width="16" fill="none" stroke-linecap="round"/>
  <rect x="140" y="440" width="320" height="480" rx="120" fill="${accent}"/>
  <rect x="160" y="900" width="90" height="260" rx="40" fill="${color}"/>
  <rect x="350" y="900" width="90" height="260" rx="40" fill="${color}"/>
  <text x="300" y="700" text-anchor="middle" font-family="${FONT}" font-size="64" font-weight="700" fill="#ffffff">${name}</text>
</svg>`
}

/** Marco con el centro transparente. */
export function frameSvg(name: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <path fill="${color}" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M60 60V${H - 260}H${W - 60}V60Z"/>
  <rect x="60" y="60" width="${W - 120}" height="${H - 320}" fill="none" stroke="#ffffff" stroke-width="8"/>
  ${label(name, H - 130, 64)}
</svg>`
}

/** Logotipo de prueba con fondo transparente. */
export function logoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <circle cx="200" cy="200" r="180" fill="#ffffff"/>
  <circle cx="200" cy="200" r="150" fill="none" stroke="#d62828" stroke-width="20"/>
  <text x="200" y="240" text-anchor="middle" font-family="${FONT}" font-size="120" font-weight="700" fill="#0b1f3a">EP</text>
</svg>`
}

/** Imagen de presentación de la campaña. */
export function campaignCardSvg(title: string, subtitle: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 720" width="1080" height="720">
  <rect width="1080" height="720" fill="${color}"/>
  <circle cx="900" cy="140" r="220" fill="#ffffff" opacity="0.12"/>
  <circle cx="160" cy="620" r="180" fill="#ffffff" opacity="0.08"/>
  <text x="80" y="330" font-family="${FONT}" font-size="88" font-weight="700" fill="#ffffff">${title}</text>
  <text x="80" y="420" font-family="${FONT}" font-size="44" fill="#ffffff" opacity="0.85">${subtitle}</text>
</svg>`
}
