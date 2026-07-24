<template>
  <div class="maxkb-config-tab">
    <!-- 模块标题栏 -->
    <div class="module-header">
      <div class="module-title">
        <el-icon :size="18"><Collection /></el-icon>
        <div>
          <h4>MaxKB 知识库集成</h4>
          <span class="module-desc">将标准规范同步到 MaxKB，审查时由 RAG 引擎自动检索相关条文</span>
        </div>
      </div>
      <span
        class="module-status"
        :class="maxkbStatus?.initialized ? 'ready' : maxkbStatus?.maxkbReachable ? 'pending' : 'offline'"
      >
        {{ maxkbStatus?.initialized ? '已初始化' : maxkbStatus?.maxkbReachable ? '待初始化' : '未连接' }}
      </span>
    </div>

    <!-- 状态指标 -->
    <div class="metrics-row" v-if="maxkbStatus">
      <div class="metric">
        <span class="metric-dot" :class="maxkbStatus.maxkbReachable ? 'online' : 'offline'"></span>
        <div>
          <div class="metric-label">服务状态</div>
          <div class="metric-value" :class="maxkbStatus.maxkbReachable ? 'online' : 'offline'">
            {{ maxkbStatus.maxkbReachable ? '在线' : '离线' }}
          </div>
        </div>
      </div>
      <div class="metric">
        <span class="metric-dot" :class="maxkbStatus.initialized ? 'ready' : 'pending'"></span>
        <div>
          <div class="metric-label">集成状态</div>
          <div class="metric-value" :class="maxkbStatus.initialized ? 'ready' : 'pending'">
            {{ maxkbStatus.initialized ? '已就绪' : '待初始化' }}
          </div>
        </div>
      </div>
      <div class="metric">
        <span class="metric-dot neutral"></span>
        <div>
          <div class="metric-label">知识库文档</div>
          <div class="metric-value">{{ maxkbStatus.knowledgeDocCount ?? 0 }}</div>
        </div>
      </div>
    </div>

    <!-- 连接配置 -->
    <div class="module-body">
      <div class="section-title">连接配置</div>

      <el-form :model="maxkbConfigForm" label-width="100px" label-position="left">
        <el-form-item label="MaxKB 地址">
          <el-input v-model="maxkbConfigForm.baseUrl" placeholder="http://localhost:8080" clearable>
            <template #append>
              <el-button @click="testConnection" :loading="testConnLoading">检测</el-button>
            </template>
          </el-input>
          <div class="form-tip">MaxKB 服务访问地址，默认同机部署为 http://localhost:8080</div>
        </el-form-item>

        <el-form-item label="管理员账号">
          <el-input v-model="maxkbConfigForm.username" placeholder="admin" />
        </el-form-item>

        <el-form-item label="管理员密码">
          <el-input v-model="maxkbConfigForm.password" type="password" placeholder="MaxKB 管理员密码" show-password />
        </el-form-item>
      </el-form>

      <div v-if="!maxkbStatus?.maxkbReachable" class="offline-hint">
        MaxKB 服务不可达，请确保服务已启动或检查连接配置。
      </div>

      <div class="form-actions">
        <el-button @click="handleSaveMaxKBConfig" :loading="saveLoading" type="primary">
          <el-icon><Check /></el-icon>
          保存配置
        </el-button>
        <template v-if="maxkbStatus?.maxkbReachable">
          <el-button :loading="maxkbInitLoading" @click="handleInitializeMaxKB">
            <el-icon><MagicStick /></el-icon>
            {{ maxkbStatus?.initialized ? '重新初始化' : '一键初始化' }}
          </el-button>
          <el-button :disabled="!maxkbStatus?.initialized" @click="handleHitTest">
            <el-icon><Search /></el-icon>
            命中测试
          </el-button>
        </template>
      </div>
    </div>

    <!-- 命中测试对话框 -->
    <el-dialog v-model="hitTestVisible" title="知识库命中测试" width="640px" destroy-on-close>
      <div class="hit-test-form">
        <el-form label-width="90px">
          <el-form-item label="查询文本">
            <el-input v-model="hitTestQuery" type="textarea" :rows="3" placeholder="输入测试查询文本" />
          </el-form-item>
          <el-form-item label="返回条数">
            <el-input-number v-model="hitTestTopN" :min="1" :max="20" />
          </el-form-item>
        </el-form>
      </div>

      <div v-if="hitTestResults.length > 0" class="hit-test-results">
        <div class="results-header">
          <span>检索结果</span>
          <span class="results-count">{{ hitTestResults.length }} 条</span>
        </div>
        <div class="results-list">
          <div v-for="(r, i) in hitTestResults" :key="i" class="hit-card">
            <div class="hit-card-header">
              <span class="hit-title">{{ r.document_name || r.title || `结果 ${i + 1}` }}</span>
              <span class="hit-score">{{ ((r.similarity || 0) * 100).toFixed(1) }}%</span>
            </div>
            <div class="hit-content">{{ r.content?.slice(0, 300) }}{{ r.content?.length > 300 ? '...' : '' }}</div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="hitTestVisible = false">关闭</el-button>
        <el-button type="primary" @click="executeHitTest" :loading="hitTestLoading">
          <el-icon><Search /></el-icon>
          测试
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { 
  Check, Clock, Monitor, Collection, Document, Files, Setting, 
  MagicStick, Refresh, Search, RefreshRight
} from '@element-plus/icons-vue'
import {
  getMaxKBStatusApi,
  initializeMaxKBApi,
  maxKBHitTestApi,
  getMaxKBConfigApi,
  saveMaxKBConfigApi,
  testMaxKBConnectionApi,
} from '@/api/maxkb'

const saveLoading = ref(false)
const testConnLoading = ref(false)
const maxkbStatus = ref<any>(null)
const maxkbInitLoading = ref(false)

const maxkbConfigForm = reactive({
  baseUrl: 'http://localhost:8080',
  username: 'admin',
  password: '',
})

const hitTestVisible = ref(false)
const hitTestQuery = ref('电缆敷设路径节点')
const hitTestTopN = ref(5)
const hitTestResults = ref<any[]>([])
const hitTestLoading = ref(false)

const testConnection = async () => {
  if (!maxkbConfigForm.baseUrl) {
    ElMessage.warning('请先填写 MaxKB 地址')
    return
  }
  testConnLoading.value = true
  try {
    const { data } = await testMaxKBConnectionApi({
      baseUrl: maxkbConfigForm.baseUrl,
      username: maxkbConfigForm.username,
      password: maxkbConfigForm.password,
    })
    if (data?.reachable) {
      ElMessage.success('MaxKB 服务连接正常！')
    } else {
      ElMessage.error(`无法连接到 MaxKB 服务${data?.error ? `: ${data.error}` : ''}`)
    }
  } catch (e: any) {
    ElMessage.error(`无法连接到 MaxKB 服务: ${e.message || '请检查地址和网络'}`)
  } finally {
    testConnLoading.value = false
  }
}

const handleRefreshMaxKBStatus = async () => {
  try {
    const { data } = await getMaxKBStatusApi()
    maxkbStatus.value = data
  } catch (e) {
    console.error('刷新状态失败', e)
  }
}

const handleSaveMaxKBConfig = async () => {
  if (!maxkbConfigForm.baseUrl) {
    ElMessage.warning('请填写 MaxKB 地址')
    return
  }
  saveLoading.value = true
  try {
    await saveMaxKBConfigApi(maxkbConfigForm)
    ElMessage.success('配置已保存')
    await handleRefreshMaxKBStatus()
  } catch (e: any) {
    ElMessage.error(`保存失败: ${e.message || '请检查配置'}`)
  } finally {
    saveLoading.value = false
  }
}

const handleInitializeMaxKB = async () => {
  maxkbInitLoading.value = true
  try {
    const { data } = await initializeMaxKBApi()
    ElMessage.success('MaxKB 集成初始化成功！')
    await handleRefreshMaxKBStatus()
  } catch (e: any) {
    ElMessage.error(`初始化失败: ${e.message || '请检查 MaxKB 服务'}`)
  } finally {
    maxkbInitLoading.value = false
  }
}

const handleHitTest = () => {
  hitTestVisible.value = true
  hitTestResults.value = []
}

const executeHitTest = async () => {
  if (!hitTestQuery.value.trim()) {
    ElMessage.warning('请输入查询文本')
    return
  }
  hitTestLoading.value = true
  try {
    const { data } = await maxKBHitTestApi({
      query: hitTestQuery.value,
      topNumber: hitTestTopN.value,
    })
    hitTestResults.value = data?.results || []
  } catch (e: any) {
    ElMessage.error(`命中测试失败: ${e.message}`)
  } finally {
    hitTestLoading.value = false
  }
}

onMounted(async () => {
  await handleRefreshMaxKBStatus()
  try {
    const { data: configData } = await getMaxKBConfigApi()
    if (configData) {
      maxkbConfigForm.baseUrl = configData.baseUrl || 'http://localhost:8080'
      maxkbConfigForm.username = configData.username || 'admin'
    }
  } catch (e) {
    console.error('加载配置失败', e)
  }
})
</script>

<style scoped>
.maxkb-config-tab {
  display: flex;
  flex-direction: column;
}

/* 模块标题栏 */
.module-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid #f1f5f9;
  background: #fafbfc;
}

.module-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.module-title :deep(.el-icon) {
  color: #64748b;
  flex-shrink: 0;
}

.module-title h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.module-desc {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
}

.module-status {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  flex-shrink: 0;
}

.module-status.ready {
  background: #f0fdf4;
  color: #15803d;
}

.module-status.pending {
  background: #fffbeb;
  color: #b45309;
}

.module-status.offline {
  background: #f1f5f9;
  color: #64748b;
}

/* 状态指标 */
.metrics-row {
  display: flex;
  gap: 32px;
  padding: 16px 20px;
  border-bottom: 1px solid #f1f5f9;
}

.metric {
  display: flex;
  align-items: center;
  gap: 10px;
}

.metric-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #cbd5e1;
  flex-shrink: 0;
}

.metric-dot.online { background: #10b981; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15); }
.metric-dot.offline { background: #ef4444; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15); }
.metric-dot.ready { background: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15); }
.metric-dot.pending { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15); }

.metric-label {
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 1px;
}

.metric-value {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
}

.metric-value.online { color: #15803d; }
.metric-value.offline { color: #b91c1c; }
.metric-value.ready { color: #2563eb; }
.metric-value.pending { color: #b45309; }

/* 模块主体 */
.module-body {
  padding: 16px 20px 18px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f1f5f9;
}

.form-tip {
  font-size: 12px;
  color: #64748b;
  margin-top: 4px;
  line-height: 1.5;
}

.offline-hint {
  margin: 8px 0 12px;
  padding: 8px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-size: 12px;
  color: #b91c1c;
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid #f1f5f9;
  margin-top: 4px;
}

/* 命中测试 */
.hit-test-form {
  margin-bottom: 16px;
}

.hit-test-results {
  border-top: 1px solid #f1f5f9;
  padding-top: 16px;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}

.results-count {
  font-size: 12px;
  color: #64748b;
  font-weight: 500;
  padding: 2px 8px;
  background: #f1f5f9;
  border-radius: 4px;
}

.results-list {
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hit-card {
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fafbfc;
}

.hit-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.hit-title {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hit-score {
  font-size: 12px;
  font-weight: 600;
  color: #2563eb;
  flex-shrink: 0;
}

.hit-content {
  font-size: 12.5px;
  color: #475569;
  line-height: 1.6;
  white-space: pre-wrap;
}

@media (max-width: 640px) {
  .metrics-row {
    flex-direction: column;
    gap: 12px;
  }

  .module-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
</style>
