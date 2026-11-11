import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Servicio de publicación incluido en el instalador: solo cuando lo pide `npm run dist`
 * (TOTEM_EMBED_PUBLICATION=1). Sale de .data/config/publicador-produccion.json, que no se versiona.
 */
function builtInPublication(): { baseUrl: string; secret: string } | null {
  if (process.env['TOTEM_EMBED_PUBLICATION'] !== '1') return null
  const file = resolve('.data/config/publicador-produccion.json')
  if (!existsSync(file)) {
    console.warn('Sin publicador-produccion.json: el instalador no incluirá el servicio de publicación.')
    return null
  }
  const { baseUrl, secret } = JSON.parse(readFileSync(file, 'utf8')) as { baseUrl: string; secret: string }
  return { baseUrl, secret }
}

export default defineConfig({
  main: {
    define: { __BUILT_IN_PUBLICATION__: JSON.stringify(builtInPublication()) },
    build: {
      rollupOptions: { input: { index: resolve('src/main/index.ts') } }
    }
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve('src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    // Se optimizan al arrancar el servidor de desarrollo. Si Vite las descubre durante la primera
    // carga, recarga la página a mitad de camino y la ventana puede quedar en blanco.
    optimizeDeps: {
      include: ['react', 'react/jsx-dev-runtime', 'react-dom/client', 'zod']
    },
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } }
    },
    plugins: [react()]
  }
})
