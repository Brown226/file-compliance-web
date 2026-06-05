<template>
  <div class="maxkb-config-tab">
    <!-- 说明横幅 -->
    <div class="info-banner">
      <div class="banner-icon">🧠</div>
      <div class="banner-content">
        <div class="banner-title">MaxKB 知识库集成</div>
        <div class="banner-desc">将标准规范同步到 MaxKB 知识库，审查时由 RAG 引擎自动检索相关条文</div>
      </div>
      <el-tag v-if="maxkbStatus?.initialized" type="success" size="large" effect="dark">
        <el-icon><Check /></el-icon> 已初始化
      </el-tag>
      <el-tag v-else type="warning" size="large" effect="plain">
        <el-icon><Clock /></el-icon> 未初始化
      </el-tag>
    </div>

    <!-- 状态概览 -->
    <div class="status-cards" v-if="maxkbStatus">
      <div class="status-card">
        <div class="status-icon" :class="maxkbStatus.maxkbReachable ? 'online' : 'offline'">
          <el-icon><Monitor /></el-icon>
        </div>
        <div class="status-info">
          <div class="status-label">服务状态</div>
          <div class="status-value" :class="maxkbStatus.maxkbReachable ? 'online' : 'offline'">
            {{ maxkbStatus.maxkbReachable ? '在线' : '离线' }}
          </div>
        </div>
      </div>
      <div class="status-card">
        <div class="status-icon" :class="maxkbStatus.initialized ? 'ready' : 'pending'">
          <el-icon><Collection /></el-icon>
        </div>
        <div class="status-info">
          <div class="status-label">集成状态</div>
          <div class="status-value" :class="maxkbStatus.initialized ? 'ready' : 'pending'">
            {{ maxkbStatus.initialized ? '已就绪' : '待初始化' }}
          </div>
        </div>
      </div>
      <div class="status-card">
        <div class="status-icon knowledge">
          <el-icon><Document /></el-icon>
        </div>
        <div class="status-info">
          <div class="status-label">知识库文档</div>
          <div class="status-value">{{ maxkbStatus.knowledgeDocCount ?? '-' }}</div>
        </div>
      </div>
    </div>

    <!-- 配置区域 -->
    <div class="config-section">
      <div class="section-title">
        <el-icon><Setting /></el-icon>
        <span>连接配置</span>
      </div>
      
      <div class="config-card">
        <el-form :model="maxkbConfigForm" label-width="110px" label-position="left">
          <el-form-item label="MaxKB 地址">
            <el-input v-model="maxkbConfigForm.baseUrl" placeholder="http://localhost:8080" clearable>
              <template #append>
                <el-button @click="testConnection" :loading="testConnLoading" class="test-btn-small">检测</el-button>
              </template>
            </el-input>
            <div class="form-tip">MaxKB 服务的访问地址，默认同机部署为 http://localhost:8080</div>
          </el-form-item>
          
          <el-form-item label="管理员账号">
            <el-input v-model="maxkbConfigForm.username" placeholder="admin" />
          </el-form-item>
          
          <el-form-item label="管理员密码">
            <el-input v-model="maxkbConfigForm.password" type="password" placeholder="MaxKB 管理员密码" show-password />
          </el-form-item>
        </el-form>
        
        <div class="form-actions">
          <el-button @click="handleSaveMaxKBConfig" :loading="saveLoading" type="primary">
            <el-icon><Check /></el-icon>
            保存配置
          </el-button>
          <template v-if="maxkbStatus?.maxkbReachable">
            <el-button 
              :loading="maxkbInitLoading"
              @click="handleInitializeMaxKB"
            >
              <el-icon><MagicStick /></el-icon>
              {{ maxkbStatus?.initialized ? '重新初始化' : '一键初始化' }}
            </el-button>
            
            <el-button 
              type="info"
              :disabled="!maxkbStatus?.initialized"
              @click="handleHitTest"
            >
              <el-icon><Search /></el-icon>
              命中测试
            </el-button>
          </template>
        </div>
      </div>
    </div>

    <!-- 提示信息 -->
    <el-alert
      v-if="!maxkbStatus?.maxkbReachable"
      title="MaxKB 服务不可达"
      description="请确保 MaxKB 服务已启动，或检查连接配置是否正确。"
      type="error"
      show-icon
      :closable="false"
    />

    <!-- 命中测试对话框 -->
    <el-dialog v-model="hitTestVisible" title="知识库命中测试" width="640px" destroy-on-close>
      <div class="hit-test-form">
        <el-form label-width="90px">
          <el-form-item label="查询文本">
            <el-input 
              v-model="hitTestQuery" 
              type="textarea" 
              :rows="3" 
              placeholder="输入测试查询文本"
            />
          </el-form-item>
          <el-form-item label="返回条数">
            <el-input-number v-model="hitTestTopN" :min="1" :max="20" />
          </el-form-item>
        </el-form>
      </div>
      
      <div v-if="hitTestResults.length > 0" class="hit-test-results">
        <div class="results-header">
          <span>检索结果</span>
          <el-tag type="info" size="small">{{ hitTestResults.length }} 条</el-tag>
        </div>
        <div class="results-list">
          <el-card 
            v-for="(r, i) in hitTestResults" 
            :key="i" 
            shadow="never" 
            class="hit-card"
          >
            <template #header>
              <div class="hit-card-header">
                <span class="hit-title">{{ r.document_name || r.title || `结果 ${i + 1}` }}</span>
                <el-tag type="success" size="small">
                  {{ ((r.similarity || 0) * 100).toFixed(1) }}%
                </el-tag>
              </div>
            </template>
            <div class="hit-content">{{ r.content?.slice(0, 300) }}{{ r.content?.length > 300 ? '...' : '' }}</div>
          </el-card>
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
  gap: 20px;
  padding: 8px 0;
}

/* 信息横幅 */
.info-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
  border-radius: var(--corp-radius-lg);
  color: #fff;
}

.banner-icon {
  font-size: 32px;
  flex-shrink: 0;
}

.banner-content {
  flex: 1;
}

.banner-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}

.banner-desc {
  font-size: 13px;
  opacity: 0.9;
}

/* 状态卡片 */
.status-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

.status-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: var(--bg-surface);
  border-radius: var(--corp-radius-md);
  border: 1px solid var(--corp-border-light);
}

.status-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}

.status-icon.online { background: #e8f5e9; color: #4caf50; }
.status-icon.offline { background: #ffebee; color: #f44336; }
.status-icon.ready { background: #e3f2fd; color: #2196f3; }
.status-icon.pending { background: #fff3e0; color: #ff9800; }
.status-icon.knowledge { background: #f3e5f5; color: #9c27b0; }
.status-icon.standard { background: #e0f7fa; color: #00bcd4; }

.status-info {
  flex: 1;
}

.status-label {
  font-size: 12px;
  color: var(--corp-text-secondary);
  margin-bottom: 2px;
}

.status-value {
  font-size: 15px;
  font-weight: 600;
}

.status-value.online, .status-value.ready { color: #4caf50; }
.status-value.offline, .status-value.pending { color: #ff9800; }

/* LLM 信息卡片 */
.llm-info-card {
  background: var(--bg-surface);
  border-radius: var(--corp-radius-lg);
  border: 1px solid var(--corp-border-light);
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #fafafa;
  border-bottom: 1px solid var(--corp-border-light);
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.model-list {
  padding: 12px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #fff;
  border: 1px solid var(--corp-border-light);
  border-radius: 20px;
  font-size: 13px;
}

.model-name {
  font-weight: 500;
  color: var(--corp-text-primary);
}

.model-id {
  font-size: 11px;
  color: var(--corp-text-secondary);
  font-family: monospace;
}

/* 配置区域 */
.config-section {
  background: var(--bg-surface);
  border-radius: var(--corp-radius-lg);
  border: 1px solid var(--corp-border-light);
  overflow: hidden;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #fafafa;
  border-bottom: 1px solid var(--corp-border-light);
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.config-card {
  padding: 20px;
  background: #fff;
}

.form-tip {
  font-size: 12px;
  color: var(--corp-text-secondary);
  margin-top: 4px;
  line-height: 1.4;
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--corp-border-light);
  margin-top: 8px;
}

.test-btn-small {
  font-size: 12px;
}

/* 操作按钮 */
.action-section {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

/* 命中测试 */
.hit-test-form {
  margin-bottom: 16px;
}

.hit-test-results {
  border-top: 1px solid var(--corp-border-light);
  padding-top: 16px;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.results-list {
  max-height: 300px;
  overflow-y: auto;
}

.hit-card {
  margin-bottom: 10px;
  border: 1px solid var(--corp-border-light);
}

.hit-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.hit-title {
  font-weight: 500;
  color: var(--corp-text-primary);
}

.hit-content {
  font-size: 13px;
  color: var(--corp-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
}

@media (max-width: 900px) {
  .status-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .status-cards {
    grid-template-columns: 1fr;
  }
  
  .action-section {
    flex-direction: column;
  }
}
</style>
