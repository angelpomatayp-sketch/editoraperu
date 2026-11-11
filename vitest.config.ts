import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Varias pruebas componen imágenes, ejecutan el modelo de recorte o derivan contraseñas con scrypt.
    testTimeout: 20_000
  }
})