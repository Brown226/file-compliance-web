import { defineConfig } from 'vite'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'
// legacy 已移除：内网环境浏览器版本可控（Chrome 90+），无需降级适配。
// legacy 插件会生成双倍 JS/CSS + system-js runtime（~80KB），且 CSS 降级转换
// 可能导致 Lightning CSS 颜色异常、整体对比度下降等问题。
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // 如需支持 IE/旧浏览器，取消下方注释并调整 targets
    // legacy({
    //   targets: ['Chrome >= 90', 'Firefox >= 85', 'Safari >= 14', 'Edge >= 90'],
    //   additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
    // }),
    // Element Plus 按需自动导入
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    // es2020 对应 Chrome 80+ / Firefox 78+ / Safari 14+ / Edge 80+
    // 内网环境浏览器版本可控，无需降级到 es2015
    target: 'es2020',
    // 生成 sourcemap 便于内网调试
    sourcemap: true,
    // 手动分包策略
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
          'element-plus': ['element-plus', '@element-plus/icons-vue'],
          'echarts': ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
        },
      },
    },
  },
  // WASM 支持配置
  optimizeDeps: {
    exclude: ['@mlightcad/libredwg-web'],
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    port: 5173,
    proxy: {
      // 所有 API 请求代理到审查平台后端
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // WebSocket 代理
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
