import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        'content-chatgpt': resolve(__dirname, 'src/content/chatgpt.ts'),
        'content-gemini': resolve(__dirname, 'src/content/gemini.ts'),
        'content-deepseek': resolve(__dirname, 'src/content/deepseek.ts'),
        'content-kimi': resolve(__dirname, 'src/content/kimi.ts'),
        'content-qianwen': resolve(__dirname, 'src/content/qianwen.ts'),
        'content-zhipu': resolve(__dirname, 'src/content/zhipu.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  }
})
