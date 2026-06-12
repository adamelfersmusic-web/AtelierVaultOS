import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works at the project-pages URL
// (https://<user>.github.io/AtelierVaultOS/) without configuration.
export default defineConfig({
  base: './',
  plugins: [react()],
})
