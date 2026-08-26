<template>
  <div class="system-management">
    <section class="hero-card">
      <div class="hero-copy">
        <p class="eyebrow">SYSTEM CONTROL</p>
        <h2>系统设置</h2>
        <p class="hero-desc">把分散的后台配置收敛成四类：组织与权限、平台资源、AI 能力、系统参数。避免把规则、标准、审计和系统设置混在一起。</p>
      </div>
      <div class="hero-meta">
        <div class="meta-pill">统一入口</div>
        <div class="meta-pill">按职责分组</div>
        <div class="meta-pill">减少误点</div>
      </div>
    </section>

    <section v-for="group in navGroups" :key="group.title" class="group-section">
      <div class="group-header">
        <h3>{{ group.title }}</h3>
        <p>{{ group.desc }}</p>
      </div>
      <div class="nav-grid">
        <button
          v-for="card in group.items"
          :key="card.path"
          class="nav-card"
          :class="{ active: route.path === card.path }"
          @click="router.push(card.path)"
        >
          <div class="nav-card-top">
            <span class="nav-icon">{{ card.icon }}</span>
            <span class="nav-badge">{{ card.badge }}</span>
          </div>
          <div class="nav-label">{{ card.label }}</div>
          <div class="nav-desc">{{ card.desc }}</div>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

const navGroups = [
  {
    title: '组织与权限',
    desc: '管理组织架构、账号归属与权限入口。',
    items: [
      { path: '/admin/users', label: '部门与员工', icon: '🏢', badge: '组织', desc: '部门树、员工账号、批量导入与账号维护。' },
    ],
  },
  {
    title: '平台资源',
    desc: '管理文件存储、清理与运行资源占用。',
    items: [
      { path: '/admin/storage', label: '存储管理', icon: '🗂️', badge: '资源', desc: '查看存储占用、清理孤立文件、检查资源使用。' },
    ],
  },
  {
    title: 'AI 与解析能力',
    desc: '管理大模型、向量模型和 OCR/解析相关配置。',
    items: [
      { path: '/admin/ai-engine', label: 'AI 引擎', icon: '🧠', badge: '模型', desc: '聊天模型、Embedding、OCR、知识库与 Provider 配置。' },
      { path: '/admin/ai-call-dashboard', label: 'AI 调用看板', icon: '📊', badge: '可观测', desc: '查看 LLM 调用次数、Token 消耗、响应耗时与错误率（可观测性 P2）。' },
    ],
  },
  {
    title: '系统参数',
    desc: '管理平台名称、上传限制和基础系统参数。',
    items: [
      { path: '/admin/basic', label: '基础设置', icon: '⚙️', badge: '参数', desc: '系统名称、上传限制、基础运行参数。' },
    ],
  },
]
</script>

<style scoped>
.system-management {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.hero-card {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 28px 30px;
  border-radius: 18px;
  background: linear-gradient(135deg, var(--color-gray-900) 0%, var(--color-gray-800) 55%, var(--color-gray-700) 100%);
  color: var(--color-gray-50);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 0.16em;
  opacity: 0.72;
}

.hero-copy h2 {
  margin: 0 0 10px;
  font-size: 28px;
  font-weight: 700;
}

.hero-desc {
  margin: 0;
  max-width: 760px;
  line-height: 1.7;
  color: rgba(248, 250, 252, 0.82);
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-content: flex-start;
}

.meta-pill {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.group-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.group-header h3 {
  margin: 0 0 4px;
  font-size: 18px;
  color: var(--corp-text-primary);
}

.group-header p {
  margin: 0;
  color: var(--corp-text-secondary);
  font-size: 13px;
}

.nav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}

.nav-card {
  border: 1px solid var(--corp-border-light);
  background: var(--bg-surface);
  border-radius: 16px;
  padding: 20px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease;
}

.nav-card:hover {
  border-color: var(--color-gray-400);
}

.nav-card.active {
  border-color: var(--color-primary-600);
  box-shadow: 0 0 0 3px rgba(39, 81, 124, 0.08);
}

.nav-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.nav-icon {
  font-size: 26px;
}

.nav-badge {
  font-size: 12px;
  color: var(--color-gray-600);
  background: var(--bg-surface-active);
  border-radius: 999px;
  padding: 4px 10px;
  font-weight: 600;
}

.nav-label {
  font-size: 16px;
  font-weight: 700;
  color: var(--corp-text-primary);
  margin-bottom: 6px;
}

.nav-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--corp-text-secondary);
}

@media (max-width: 960px) {
  .system-management {
    padding: 16px;
  }

  .hero-card {
    flex-direction: column;
    padding: 22px;
  }
}
</style>
