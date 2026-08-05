/**
 * 前端 Vitest 配置
 *
 * 与 backend/vitest.config.ts 同版本（vitest 2.x）。
 *
 * 注意：
 * - 只挂 vue() 插件，不挂 unplugin-auto-import / unplugin-vue-components：
 *   测试中 el-* 组件用 global.stubs / shallowMount 处理，避免 ElementPlusResolver
 *   把 el-* 转成真实 import（慢 + jsdom 下 teleport/popper 有坑）。
 * - '@' 别名与 vite.config.ts 保持一致（resolve(__dirname, 'src')）。
 * - 测试文件放 src 下的 __tests__ 目录，会被 tsconfig.app.json 覆盖（类型检查生效）。
 */
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
})
