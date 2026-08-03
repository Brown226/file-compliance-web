<template>
  <div class="worktrees-panel">
    <!-- 未配置仓库提示 -->
    <div v-if="!loading && !configured" class="empty-state">
      <el-icon :size="28" color="#c0c4cc"><FolderOpened /></el-icon>
      <p>未配置主仓库</p>
      <p class="empty-sub">服务端设置 AGENT_REPO_ROOT 后可创建 git worktree 工作区</p>
    </div>

    <!-- 空状态 -->
    <div v-else-if="worktrees.length === 0 && !loading" class="empty-state">
      <el-icon :size="28" color="#c0c4cc"><FolderAdd /></el-icon>
      <p>暂无 Worktree</p>
      <p class="empty-sub">为子任务创建独立分支工作区，互不干扰</p>
    </div>

    <!-- 列表 -->
    <div v-else class="worktree-list">
      <div
        v-for="wt in worktrees"
        :key="wt.path"
        class="worktree-item"
        :class="{ main: wt.isMain }"
      >
        <div class="wt-head">
          <span class="wt-branch">{{ wt.branch }}</span>
          <el-tag v-if="wt.isMain" size="small" type="warning" effect="plain">主</el-tag>
          <el-button
            v-else
            text
            size="small"
            type="danger"
            :icon="Delete"
            title="删除工作区"
            @click="handleRemove(wt)"
          />
        </div>
        <div class="wt-meta">
          <span class="wt-head-hash" :title="wt.head">{{ wt.head }}</span>
          <span class="wt-path" :title="wt.path">{{ shortPath(wt.path) }}</span>
        </div>
      </div>
    </div>

    <!-- 新建 -->
    <div class="panel-footer">
      <el-button size="small" type="primary" plain :icon="Plus" class="new-wt-btn" :disabled="!configured" @click="createVisible = true">
        新建 Worktree
      </el-button>
    </div>

    <el-dialog v-model="createVisible" title="新建 Worktree" width="420px" append-to-body>
      <el-form label-width="80px" label-position="top">
        <el-form-item label="分支名（新分支）">
          <el-input v-model="branchInput" placeholder="如 task-doc-summary" @keyup.enter="handleCreate" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderOpened, FolderAdd, Plus, Delete } from '@element-plus/icons-vue'
import { listWorktreesApi, createWorktreeApi, deleteWorktreeApi, type WorktreeInfo } from '@/api/agent'

const worktrees = ref<WorktreeInfo[]>([])
const loading = ref(false)
const configured = ref(true)
const createVisible = ref(false)
const creating = ref(false)
const branchInput = ref('')

async function loadWorktrees() {
  loading.value = true
  try {
    const res = await listWorktreesApi()
    worktrees.value = res.data || []
    configured.value = true
  } catch (e: any) {
    // 未配置 AGENT_REPO_ROOT 时后端返回空列表（不报错）；此处兜底
    worktrees.value = []
    configured.value = false
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  const branch = branchInput.value.trim()
  if (!branch) {
    ElMessage.warning('请输入分支名')
    return
  }
  creating.value = true
  try {
    await createWorktreeApi(branch)
    ElMessage.success(`已创建 worktree（分支 ${branch}）`)
    createVisible.value = false
    branchInput.value = ''
    await loadWorktrees()
  } catch (e: any) {
    ElMessage.error(`创建失败：${e?.message || e}`)
  } finally {
    creating.value = false
  }
}

async function handleRemove(wt: WorktreeInfo) {
  try {
    await ElMessageBox.confirm(`删除工作区「${wt.branch}」（${shortPath(wt.path)}）？分支本身不会被删除。`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await deleteWorktreeApi(wt.path)
    ElMessage.success('已删除')
    await loadWorktrees()
  } catch (e: any) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(`删除失败：${e?.message || e}`)
  }
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts.slice(-2).join('/')
}

onMounted(loadWorktrees)
</script>

<style scoped>
.worktrees-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-dim, #909399);
  font-size: 13px;
}
.empty-sub {
  font-size: 12px;
  color: var(--text-dim, #909399);
}

.worktree-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.worktree-item {
  border: 1px solid var(--border, #e4e7ed);
  border-radius: 6px;
  padding: 8px 10px;
}
.worktree-item.main {
  background: var(--bg-hover, #f5f7fa);
}

.wt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.wt-branch {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #303133);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wt-meta {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted, #606266);
}
.wt-head-hash {
  font-family: var(--font-mono, ui-monospace, monospace);
  color: var(--accent, #409eff);
}
.wt-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-footer {
  padding-top: 8px;
  border-top: 1px solid var(--border, #e4e7ed);
}
.new-wt-btn {
  width: 100%;
}
</style>
