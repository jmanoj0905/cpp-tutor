import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs so the same build works from the root static mount in
  // the all-in-one image AND inside a VSCode webview, where every asset must be
  // rewritten to a vscode-webview:// URI before it will load.
  base: './',
  plugins: [react()],
})
