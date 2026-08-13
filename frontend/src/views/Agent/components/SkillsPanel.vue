<template>
  <!-- 完全复刻参考项目 SkillsConfig：自绘遮罩 + 860px 双栏弹窗 -->
  <div class="skills-overlay" @click.self="emit('close')">
    <div class="skills-dialog">
      <!-- Header（对齐参考：15px/700 标题 + 等宽路径位 + × 关闭） -->
      <div class="dialog-header">
        <div class="header-left">
          <span class="header-title">Skills</span>
          <code class="header-path">{{ skills.length }} 个技能</code>
        </div>
        <button class="header-close" title="关闭" @click="emit('close')">×</button>
      </div>

      <!-- Body：左列表 + 右详情（对齐参考：210px 列表 / flex 1 详情） -->
      <div class="dialog-body">
        <div class="skill-list-col">
          <div class="skill-list-scroll">
            <div v-if="loading" class="list-hint">加载中…</div>
            <div v-else-if="skills.length === 0" class="list-hint">暂无技能</div>
            <template v-else>
              <div v-for="group in skillGroups" :key="group.label" class="skill-group">
                <div class="group-label">{{ group.label }}</div>
                <div
                  v-for="skill in group.skills"
                  :key="skill.name"
                  class="skill-row"
                  :class="{ selected: !addMode && selectedName === skill.name }"
                  @click="selectSkill(skill)"
                >
                  <span class="skill-dot" :class="{ disabled: skill.disabled }" />
                  <span class="skill-row-name" :class="{ disabled: skill.disabled }">{{ skill.name }}</span>
                </div>
              </div>
            </template>
          </div>
          <!-- 新建入口（对齐参考：底部 + Add，选中态 accent） -->
          <div class="skill-add" :class="{ active: addMode }" @click="startCreate">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            <span>新建 Skill</span>
          </div>
        </div>

        <div class="skill-detail-col">
          <!-- 新建 / 编辑表单（适配：参考为搜索安装，当前为本地创建表单） -->
          <template v-if="addMode">
            <div class="add-title">{{ editingName ? `编辑 Skill：${editingName}` : '新建 Skill' }}</div>
            <div v-if="!editingName" class="field">
              <span class="field-label">名称（小写字母/数字/下划线/中划线）</span>
              <input v-model="form.name" class="text-input" placeholder="如 doc-summary" />
            </div>
            <div class="field">
              <span class="field-label">描述（注入提示词，说明触发场景）</span>
              <input v-model="form.description" class="text-input" placeholder="如：文档总结（提取要点、生成摘要）" />
            </div>
            <div class="field">
              <span class="field-label">提示词内容（SKILL.md 正文）</span>
              <textarea v-model="form.content" class="text-area" rows="10" placeholder="# 技能名称&#10;&#10;当用户要求……时，按以下流程执行：" />
            </div>
            <div class="form-actions">
              <button class="btn" @click="addMode = false">取消</button>
              <button v-if="editingName" class="btn danger" @click="handleDelete(editingName)">删除</button>
              <button class="btn primary" :disabled="saving" @click="handleSave">{{ saving ? '保存中…' : '保存' }}</button>
            </div>
          </template>

          <!-- 详情（对齐参考 SkillDetail：标签 + 开关 + 字段组） -->
          <template v-else-if="selectedSkill">
            <div class="detail-top">
              <span class="scope-tag">global</span>
              <code class="detail-path">{{ selectedSkill.name }}</code>
              <button
                class="toggle"
                :class="{ on: !selectedSkill.disabled }"
                :disabled="toggling"
                :title="!selectedSkill.disabled ? '在提示词中可见' : '从提示词中隐藏'"
                @click="toggleSkill(selectedSkill)"
              >
                <span class="toggle-knob" />
              </button>
            </div>
            <div class="detail-field">
              <span class="detail-label">Name</span>
              <span class="detail-name">{{ selectedSkill.name }}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">Description</span>
              <span class="detail-desc">{{ selectedSkill.description || '（无描述）' }}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">Prompt</span>
              <pre class="detail-prompt">{{ selectedSkill.content }}</pre>
            </div>
            <div class="form-actions">
              <button class="btn" @click="startEdit">编辑</button>
              <button class="btn danger" @click="handleDelete(selectedSkill.name)">删除</button>
            </div>
          </template>

          <div v-else class="detail-empty">选择一个技能查看详情</div>
        </div>
      </div>

      <!-- Footer（对齐参考：左侧状态位 + 右侧关闭） -->
      <div class="dialog-footer">
        <span class="footer-note">Skill 以名称标识，启用后注入 Agent 提示词</span>
        <button class="btn" @click="emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listSkillsApi,
  createSkillApi,
  updateSkillApi,
  setSkillEnabledApi,
  deleteSkillApi,
  type AgentSkill,
} from '@/api/agent'

/**
 * Skills 管理弹窗 —— 完全复刻参考项目 pi-web-0.8.5 的 SkillsConfig：
 * - 自绘全屏遮罩 + 860px × 78vh 圆角面板（header / 双栏 body / footer）
 * - 左栏 210px 分组列表（圆点状态 + 选中态 + hover），底部「+ 新建 Skill」
 * - 右栏详情（scope 标签 + 自绘 Toggle + Name/Description/Prompt 字段）
 * - 业务适配：新建/编辑为本地表单（参考为 skills.sh 搜索安装，无对应后端）
 */

const emit = defineEmits<{ close: [] }>()

const skills = ref<AgentSkill[]>([])
const loading = ref(false)
const saving = ref(false)
const toggling = ref(false)

const selectedName = ref('')
const addMode = ref(false)
const editingName = ref('')
const form = ref({ name: '', description: '', content: '' })

/** 按启用状态分组（对齐参考的分组列表形态） */
const skillGroups = computed(() => {
  const groups: Array<{ label: string; skills: AgentSkill[] }> = []
  const enabled = skills.value.filter(s => !s.disabled)
  const disabled = skills.value.filter(s => s.disabled)
  if (enabled.length > 0) groups.push({ label: '可用', skills: enabled })
  if (disabled.length > 0) groups.push({ label: '已禁用', skills: disabled })
  return groups
})

const selectedSkill = computed(
  () => skills.value.find(s => s.name === selectedName.value) ?? null,
)

async function loadSkills() {
  loading.value = true
  try {
    const res = await listSkillsApi()
    skills.value = res.data || []
    if (skills.value.length > 0 && !selectedName.value) {
      selectedName.value = skills.value[0].name
    } else if (!skills.value.some(s => s.name === selectedName.value)) {
      selectedName.value = skills.value[0]?.name ?? ''
    }
  } catch (e: any) {
    ElMessage.error(`加载 Skills 失败：${e?.message || e}`)
  } finally {
    loading.value = false
  }
}

function selectSkill(skill: AgentSkill) {
  selectedName.value = skill.name
  addMode.value = false
}

async function toggleSkill(skill: AgentSkill) {
  toggling.value = true
  try {
    const next = skill.disabled
    await setSkillEnabledApi(skill.name, next)
    skill.disabled = !next
    // [无弹窗] 成功提示已移除：ElMessage.success(next ? `已启用 ${skill.name}` : `已禁用 ${skill.
  } catch (e: any) {
    ElMessage.error(`切换失败：${e?.message || e}`)
  } finally {
    toggling.value = false
  }
}

function startCreate() {
  editingName.value = ''
  form.value = { name: '', description: '', content: '' }
  addMode.value = true
}

function startEdit() {
  if (!selectedSkill.value) return
  editingName.value = selectedSkill.value.name
  form.value = {
    name: selectedSkill.value.name,
    description: selectedSkill.value.description,
    content: selectedSkill.value.content,
  }
  addMode.value = true
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
      // [无弹窗] 成功提示已移除：ElMessage.success('已保存')
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
      // [无弹窗] 成功提示已移除：ElMessage.success('已创建')
    }
    addMode.value = false
    if (form.value.name) selectedName.value = form.value.name
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
    // [无弹窗] 成功提示已移除：ElMessage.success('已删除')
    addMode.value = false
    if (selectedName.value === name) selectedName.value = ''
    await loadSkills()
  } catch (e: any) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(`删除失败：${e?.message || e}`)
  }
}

onMounted(loadSkills)
</script>

<style scoped>
/* ===== 遮罩 + 面板（对齐参考：rgba(0,0,0,0.35) / 860px / 78vh / 圆角 10） ===== */
.skills-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}

.skills-dialog {
  width: 860px;
  max-width: calc(100vw - 16px);
  height: 78vh;
  max-height: calc(100dvh - 16px);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

/* ===== Header ===== */
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.header-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.header-path {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  padding: 2px 6px;
}

.header-close:hover {
  color: var(--text);
}

/* ===== Body 双栏 ===== */
.dialog-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  min-height: 0;
}

/* ---- 左栏 210px 列表 ---- */
.skill-list-col {
  width: 210px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
}

.skill-list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 6px;
}

.list-hint {
  padding: 10px 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.skill-group {
  margin-bottom: 6px;
}

.group-label {
  padding: 4px 8px 3px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.skill-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px;
  border-radius: 5px;
  cursor: pointer;
  background: none;
}

.skill-row:hover {
  background: var(--bg-hover);
}

.skill-row.selected {
  background: var(--bg-selected);
}

.skill-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 4px var(--accent);
  transition: background 0.15s, box-shadow 0.15s;
}

.skill-dot.disabled {
  background: var(--border);
  box-shadow: none;
}

.skill-row-name {
  font-size: 12px;
  font-weight: 400;
  color: var(--text);
  font-family: var(--font-mono);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-row.selected .skill-row-name {
  font-weight: 600;
}

.skill-row-name.disabled {
  color: var(--text-dim);
}

/* 新建入口（对齐参考：底部 + 图标） */
.skill-add {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: 5px;
  margin: 0 6px 8px;
  cursor: pointer;
  background: none;
  color: var(--text-dim);
  font-size: 12px;
  border-top: 1px solid var(--border);
  border-radius: 0 0 5px 5px;
  padding-top: 11px;
}

.skill-add:hover {
  background: var(--bg-hover);
}

.skill-add.active {
  background: var(--bg-selected);
  color: var(--accent);
}

/* ---- 右栏详情 ---- */
.skill-detail-col {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  min-width: 0;
}

.add-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 20px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 14px;
}

.field-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}

.text-input {
  padding: 7px 10px;
  font-size: 13px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  outline: none;
  font-family: var(--font-mono);
}

.text-input:focus {
  border-color: var(--accent);
}

.text-area {
  padding: 7px 10px;
  font-size: 13px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  outline: none;
  resize: vertical;
  font-family: var(--font-mono);
  line-height: 1.6;
}

.text-area:focus {
  border-color: var(--accent);
}

/* 详情第一行：标签 + 路径 + Toggle */
.detail-top {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 20px;
}

.scope-tag {
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
  background: rgba(120, 120, 120, 0.12);
  color: var(--text-dim);
}

.detail-path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-dim);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 自绘 Toggle（对齐参考：40×22 圆角 11 + 16px 圆点滑动） */
.toggle {
  flex-shrink: 0;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: none;
  padding: 0;
  cursor: pointer;
  background: var(--border);
  position: relative;
  transition: background 0.18s;
  outline: none;
}

.toggle.on {
  background: var(--accent);
}

.toggle:disabled {
  cursor: wait;
}

.toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bg);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
  transition: left 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}

.toggle.on .toggle-knob {
  left: 21px;
}

/* 字段组（对齐参考：12px 标题 + 内容） */
.detail-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 20px;
}

.detail-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}

.detail-name {
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--text);
}

.detail-desc {
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.6;
}

.detail-prompt {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  margin: 0;
  max-height: 240px;
  overflow-y: auto;
}

.detail-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 13px;
}

/* 按钮（对齐参考 footer 按钮：6px 12px、1px 边框、圆角 6） */
.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.btn {
  padding: 6px 14px;
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.12s, color 0.12s;
}

.btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--corp-text-inverse);
  font-weight: 600;
}

.btn.primary:hover {
  background: var(--accent);
  color: var(--corp-text-inverse);
  opacity: 0.9;
}

.btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.danger:hover {
  background: color-mix(in srgb, var(--danger, var(--color-danger)) 10%, transparent);
  border-color: var(--danger, var(--color-danger));
  color: var(--danger, var(--color-danger));
}

/* ===== Footer ===== */
.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.footer-note {
  font-size: 12px;
  color: var(--text-dim);
}
</style>
