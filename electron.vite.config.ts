import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          voiceRecognitionWorker: resolve('src/main/voice-pipeline/voice-recognition-worker.ts'),
          knowledgeWorker: resolve('src/main/knowledge/knowledge-worker.ts'),
          runtimeRpcWorker: resolve('src/main/runtime-rpc/bridge-worker.ts'),
          ...(process.env.YUYU_E2E_BUILD === '1'
            ? { reportTemplateTest: resolve('src/main/report-template-test-entry.ts') }
            : {})
        },
        output: {
          entryFileNames: '[name].js'
        },
        external: ['sherpa-onnx-node', '@napi-rs/system-ocr']
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
