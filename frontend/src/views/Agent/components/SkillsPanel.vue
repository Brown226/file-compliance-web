<template>
  <div class="skills-panel">
    <!-- 空状态 -->
    <div v-if="skills.length === 0 && !loading" class="empty-state">
      <el-icon :size="28" color="#c0c4cc"><Files /></el-icon>
      <p>暂无 Skills</p>
      <p class="empty-sub">技能以 SKILL.md 形式管理，可新建办公场景技能</p>
    </div>

    <!-- 列表 -->
    <div v-else class="skill-list">
      <div v-for="skill in skills" :key="skill.name" class="skill-item" :class="{ disabled: skill.disabled }">
        <div class="skill-head">
          <div class="skill-name" @click="openDetail(skill)">
            <span class="skill-name-text">{{ skill.name }}</span>
            <el-tag v-if="skill.disabled" size="small" type="info" effect="plain">禁用</el-tag>
          </div>
          <el-switch
            :model-value="!skill.disabled"
            size="small"
            @change="(v: boolean | string | number) => toggleSkill(skill, Boolean(v))"
          />
        </div>
        <div class="skill-desc" @click="openDetail(skill)">{{ skill.description || '（无描述）' }}</div>
      </div>
    </div>

    <!-- 新建按钮 -->
    <div class="panel-footer">
      <el-button size="small" type="primary" plain :icon="Plus" class="new-skill-btn" @click="openCreate">新建 Skill</el-button>
    </div>

    <!-- 新建/编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingName ? `编辑 Skill：${editingName}` : '新建 Skill'"
      width="560px"
      append-to-body
    >
      <el-form label-width="80px" label-position="top">
        <el-form-item label="名称（小写字母/数字/下划线/中划线，即文件名）" v-if="!editingName">
          <el-input v-model="form.name" placeholder="如 doc-summary" />
        </el-form-item>
        <el-form-item label="描述（注入 Agent 提示词，说明触发场景）">
          <el-input v-model="form.description" placeholder="如：文档总结（提取要点、生成摘要）" />
        </el-form-item>
        <el-form-item label="提示词内容（SKILL.md 正文）">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="10"
            placeholder="# 技能名称&#10;&#10;当用户要求……时，按以下流程执行："
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button v-if="editingName" type="danger" plain @click="handleDelete(editingName)">删除</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Files, Plus } from '@element-plus/icons-vue'
import {
  listSkillsApi,
  createSkillApi,
  updateSkillApi,
  setSkillEnabledApi,
  deleteSkillApi,
  type AgentSkill,
} from '@/api/agent'

const skills = ref<AgentSkill[]>([])
const loading = ref(false)
const saving = ref(false)

const dialogVisible = ref(false)
const editingName = ref('')
const form = ref({ name: '', description: '', content: '' })

async function loadSkills() {
  loading.value = true
  try {
    const res = await listSkillsApi()
    skills.value = res.data || []
  } catch (e: any) {
    ElMessage.error(`加载 Skills 失败：${e?.message || e}`)
  } finally {
    loading.value = false
  }
}

async function toggleSkill(skill: AgentSkill, enabled: boolean) {
  try {
    await setSkillEnabledApi(skill.name, enabled)
    skill.disabled = !enabled
    ElMessage.success(enabled ? `已启用 ${skill.name}` : `已禁用 ${skill.name}`)
  } catch (e: any) {
    ElMessage.error(`切换失败：${e?.message || e}`)
  }
}

function openDetail(skill: AgentSkill) {
  editingName.value = skill.name
  form.value = { name: skill.name, description: skill.description, content: skill.content }
  dialogVisible.value = true
}

function openCreate() {
  editingName.value = ''
  form.value = { name: '', description: '', content: '' }
  dialogVisible.value = true
}

async function handleSave() {
  if (!form.value.content.trim()) {
    ElMessage.warning('提示词内容不能为空')
    return
  }
  saving.value = true
  try {
    if (editingName.value) {
      await updateSkillApi(editingName.value, {
        description: form.value.description,
        content: form.value.content,
      })
      ElMessage.success('已保存')
    } else {
      if (!/^[a-z0-9_-]+$/.test(form.value.name)) {
        ElMessage.warning('名称仅允许小写字母/数字/下划线/中划线')
        return
      }
      await createSkillApi({
        name: form.value.name,
        description: form.value.description,
        content: form.value.content,
      })
      ElMessage.success('已创建')
    }
    dialogVisible.value = false
    await loadSkills()
  } catch (e: any) {
    ElMessage.error(`保存失败：${e?.message || e}`)
  } finally {
    saving.value = false
  }
}

async function handleDelete(name: string) {
  try {
    await ElMessageBox.confirm(`确定删除 Skill「${name}」？此操作不可恢复。`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await deleteSkillApi(name)
    ElMessage.success('已删除')
    dialogVisible.value = false
    await loadSkills()
  } catch (e: any) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(`删除失败：${e?.message || e}`)
  }
}

onMounted(loadSkills)
</script>

<style scoped>
.skills-panel {
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

.skill-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skill-item {
  border: 1px solid var(--border, #e4e7ed);
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.skill-item:hover {
  background: var(--bg-hover, #f5f7fa);
}
.skill-item.disabled {
  opacity: 0.6;
}

.skill-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.skill-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.skill-name-text {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #303133);
}
.skill-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted, #606266);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-footer {
  padding-top: 8px;
  border-top: 1px solid var(--border, #e4e7ed);
}
.new-skill-btn {
  width: 100%;
}
</style>
