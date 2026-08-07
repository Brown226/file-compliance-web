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
    // 覆盖外层 NODE_ENV=production（用户环境变量）：production 下 Vue 走生产构建，
    // $emit 不触发 devtools 钩子，@vue/test-utils 的 emitted() 收集全部失效（2026-08 修复）。
    env: {
      NODE_ENV: 'test',
    },
    // 让 test-utils 与源码共用同一 Vue 实例（2026-08 修复）：
    // - external: ['vue'] → 源码的 import 'vue' 走原生 Node require（不经 vite 转换），
    //   与 test-utils 内部 require('vue') 命中同一份 Node 模块缓存；
    // - 不能 alias vue 到 dist 文件——vite 会 esbuild 转换出副本，实例分裂，
    //   devtools hook 设置错位 → wrapper.emitted() 收不到 $emit。
    server: {
      deps: {
        external: ['vue'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/views/Agent/**', 'src/composables/**'],
    },
  },
})
