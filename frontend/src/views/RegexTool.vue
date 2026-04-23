<template>
  <div class="regex-tool-container">
    <el-card shadow="never">
      <template #header>
        <div class="panel-header">
          <span class="panel-title">AI 正则表达式工具</span>
          <el-tag size="small" type="info">智能生成 · 实时验证 · 语法解释</el-tag>
        </div>
      </template>

      <el-tabs v-model="activeTab" class="regex-tabs">
        <!-- AI 生成正则 -->
        <el-tab-pane label="AI 生成" name="generate">
          <div class="tab-content">
            <el-row :gutter="20">
              <el-col :span="12">
                <div class="panel-section">
                  <div class="section-title">
                    <el-icon><ChatDotRound /></el-icon>
                    <span>自然语言描述</span>
                  </div>
                  <el-input
                    v-model="genForm.description"
                    type="textarea"
                    :rows="4"
                    placeholder="例如：匹配 11 位手机号码 / 匹配以 # 开头的标签 / 匹配 YYYY-MM-DD 格式的日期"
                  />
                  
                  <div class="section-title" style="margin-top: 16px;">
                    <el-icon><Document /></el-icon>
                    <span>测试用例（可选）</span>
                  </div>
                  <el-input
                    v-model="genForm.testCasesStr"
                    type="textarea"
                    :rows="3"
                    placeholder="输入期望匹配的文本，每行一个，例如：
13812345678
13900001111
12345678901"
                  />

                  <div class="action-row">
                    <el-button type="primary" :loading="genLoading" @click="handleGenerate" size="large">
                      <el-icon><MagicStick /></el-icon>
                      AI 生成正则
                    </el-button>
                    <el-button @click="handleClear('gen')">清空</el-button>
                  </div>
                </div>
              </el-col>

              <el-col :span="12">
                <div class="panel-section">
                  <div class="section-title">
                    <el-icon><Monitor /></el-icon>
                    <span>生成结果</span>
                  </div>
                  <div v-if="genResult" class="result-box">
                    <div class="regex-display">
                      <code>{{ genResult }}</code>
                      <el-button size="small" link type="primary" @click="copyToClipboard(genResult)">
                        <el-icon><CopyDocument /></el-icon>
                      </el-button>
                    </div>
                    <div class="regex-actions">
                      <el-button size="small" type="success" @click="testGeneratedRegex">
                        立即测试
                      </el-button>
                      <el-button size="small" type="info" @click="explainGeneratedRegex">
                        语法解释
                      </el-button>
                    </div>
                  </div>
                  <el-empty v-else description="生成结果将显示在这里" />
                </div>
              </el-col>
            </el-row>
          </div>
        </el-tab-pane>

        <!-- 实时测试 -->
        <el-tab-pane label="实时测试" name="test">
          <div class="tab-content">
            <el-row :gutter="20">
              <el-col :span="12">
                <div class="panel-section">
                  <div class="section-title">
                    <el-icon><Edit /></el-icon>
                    <span>正则表达式</span>
                  </div>
                  <div class="regex-input-row">
                    <el-input
                      v-model="testForm.pattern"
                      placeholder="输入正则表达式，如 \d{11}"
                      size="large"
                      class="regex-input"
                    />
                    <el-select v-model="testForm.flags" placeholder="修饰符" size="large" style="width: 100px;">
                      <el-option label="无" value="" />
                      <el-option label="g" value="g" />
                      <el-option label="i" value="i" />
                      <el-option label="gi" value="gi" />
                    </el-select>
                  </div>

                  <div class="section-title" style="margin-top: 16px;">
                    <el-icon><Document /></el-icon>
                    <span>测试文本</span>
                    <span class="hint">(每行一个测试用例)</span>
                  </div>
                  <el-input
                    v-model="testForm.testStrings"
                    type="textarea"
                    :rows="8"
                    placeholder="输入要测试的文本，每行一个：
13812345678
abc123def
12345"
                  />

                  <div class="action-row">
                    <el-button type="primary" @click="handleTest" size="large">
                      <el-icon><VideoPlay /></el-icon>
                      测试匹配
                    </el-button>
                  </div>
                </div>
              </el-col>

              <el-col :span="12">
                <div class="panel-section">
                  <div class="section-title">
                    <el-icon><SuccessFilled /></el-icon>
                    <span>匹配结果</span>
                  </div>
                  <div v-if="testResult" class="test-result">
                    <div v-if="testResult.valid" class="result-summary success">
                      <el-icon><CircleCheck /></el-icon>
                      <span>正则表达式有效</span>
                    </div>
                    <div v-else class="result-summary error">
                      <el-icon><CircleClose /></el-icon>
                      <span>正则表达式无效</span>
                    </div>

                    <div class="match-list">
                      <div
                        v-for="(item, idx) in testResult.results"
                        :key="idx"
                        class="match-item"
                        :class="{ matched: item.matched }"
                      >
                        <el-icon :color="item.matched ? '#67c23a' : '#909399'">
                          <component :is="item.matched ? 'Check' : 'Close'" />
                        </el-icon>
                        <code>{{ item.input }}</code>
                        <el-tag v-if="item.matched" size="small" type="success">匹配</el-tag>
                        <el-tag v-else size="small" type="info">不匹配</el-tag>
                      </div>
                    </div>

                    <div v-if="!testResult.results || testResult.results.length === 0" class="no-results">
                      暂无测试结果
                    </div>
                  </div>
                  <el-empty v-else description="测试结果将显示在这里" />
                </div>
              </el-col>
            </el-row>
          </div>
        </el-tab-pane>

        <!-- 语法解释 -->
        <el-tab-pane label="语法解释" name="explain">
          <div class="tab-content">
            <el-row :gutter="20">
              <el-col :span="12">
                <div class="panel-section">
                  <div class="section-title">
                    <el-icon><QuestionFilled /></el-icon>
                    <span>输入正则表达式</span>
                  </div>
                  <el-input
                    v-model="explainForm.pattern"
                    placeholder="输入要解释的正则表达式"
                    size="large"
                  />
                  <div class="action-row" style="margin-top: 16px;">
                    <el-button type="primary" :loading="explainLoading" @click="handleExplain" size="large">
                      <el-icon><Reading /></el-icon>
                      解释语法
                    </el-button>
                  </div>
                </div>
              </el-col>

              <el-col :span="12">
                <div class="panel-section">
                  <div class="section-title">
                    <el-icon><InfoFilled /></el-icon>
                    <span>解释结果</span>
                  </div>
                  <div v-if="explainResult" class="explain-result">
                    <div class="explain-summary">
                      {{ explainResult.summary }}
                    </div>

                    <div v-if="explainResult.parts && explainResult.parts.length > 0" class="explain-parts">
                      <div class="parts-title">语法分解</div>
                      <div class="part-list">
                        <div v-for="(part, idx) in explainResult.parts" :key="idx" class="part-item">
                          <code class="part-pattern">{{ part.pattern }}</code>
                          <span class="part-desc">{{ part.description }}</span>
                        </div>
                      </div>
                    </div>

                    <div v-if="explainResult.examples && explainResult.examples.length > 0" class="explain-examples">
                      <div class="examples-title">匹配示例</div>
                      <div class="example-list">
                        <el-tag v-for="(ex, idx) in explainResult.examples" :key="idx" size="small">
                          {{ ex }}
                        </el-tag>
                      </div>
                    </div>
                  </div>
                  <el-empty v-else description="解释结果将显示在这里" />
                </div>
              </el-col>
            </el-row>
          </div>
        </el-tab-pane>

        <!-- 常用模板 -->
        <el-tab-pane label="常用模板" name="templates">
          <div class="tab-content">
            <div class="template-grid">
              <div
                v-for="tmpl in commonTemplates"
                :key="tmpl.name"
                class="template-card"
                @click="useTemplate(tmpl)"
              >
                <div class="template-name">{{ tmpl.name }}</div>
                <code class="template-pattern">{{ tmpl.pattern }}</code>
                <div class="template-desc">{{ tmpl.desc }}</div>
              </div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 语法提示卡片 -->
    <el-card shadow="never" class="syntax-help-card">
      <template #header>
        <span class="card-title">正则表达式速查</span>
      </template>
      <el-collapse>
        <el-collapse-item title="字符类" name="chars">
          <div class="syntax-table">
            <div class="syntax-row"><code>\d</code><span>数字 [0-9]</span></div>
            <div class="syntax-row"><code>\w</code><span>单词字符 [a-zA-Z0-9_]</span></div>
            <div class="syntax-row"><code>\s</code><span>空白字符</span></div>
            <div class="syntax-row"><code>.</code><span>任意字符（换行除外）</span></div>
            <div class="syntax-row"><code>[abc]</code><span>匹配 a、b 或 c</span></div>
            <div class="syntax-row"><code>[^abc]</code><span>非 a、b、c 的字符</span></div>
            <div class="syntax-row"><code>[a-z]</code><span>a 到 z 的范围</span></div>
          </div>
        </el-collapse-item>
        <el-collapse-item title="量词" name="quantifiers">
          <div class="syntax-table">
            <div class="syntax-row"><code>*</code><span>零次或多次</span></div>
            <div class="syntax-row"><code>+</code><span>一次或多次</span></div>
            <div class="syntax-row"><code>?</code><span>零次或一次</span></div>
            <div class="syntax-row"><code>{n}</code><span>恰好 n 次</span></div>
            <div class="syntax-row"><code>{n,}</code><span>n 次或更多</span></div>
            <div class="syntax-row"><code>{n,m}</code><span>n 到 m 次</span></div>
          </div>
        </el-collapse-item>
        <el-collapse-item title="锚点" name="anchors">
          <div class="syntax-table">
            <div class="syntax-row"><code>^</code><span>字符串开始</span></div>
            <div class="syntax-row"><code>$</code><span>字符串结束</span></div>
            <div class="syntax-row"><code>\b</code><span>单词边界</span></div>
          </div>
        </el-collapse-item>
        <el-collapse-item title="分组" name="groups">
          <div class="syntax-table">
            <div class="syntax-row"><code>(abc)</code><span>捕获组</span></div>
            <div class="syntax-row"><code>(?:abc)</code><span>非捕获组</span></div>
            <div class="syntax-row"><code>a|b</code><span>a 或 b</span></div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ChatDotRound, Document, MagicStick, Monitor, Edit, VideoPlay,
  SuccessFilled, CircleCheck, CircleClose, Check, Close,
  QuestionFilled, Reading, InfoFilled, CopyDocument
} from '@element-plus/icons-vue'
import {
  generateRegexApi,
  explainRegexApi,
  validateRegexApi,
} from '@/api/regex'

const activeTab = ref('generate')

// ========== AI 生成 ==========
const genLoading = ref(false)
const genForm = reactive({
  description: '',
  testCasesStr: '',
})
const genResult = ref('')

const handleGenerate = async () => {
  if (!genForm.description.trim()) {
    ElMessage.warning('请输入自然语言描述')
    return
  }

  const testCases = genForm.testCasesStr
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)

  genLoading.value = true
  try {
    const { data } = await generateRegexApi({
      description: genForm.description,
      testCases: testCases.length > 0 ? testCases : undefined,
    })
    genResult.value = data.regex
    ElMessage.success('正则表达式生成成功')
  } catch (e: any) {
    console.error('生成失败', e)
    ElMessage.error(e.message || '生成失败')
  } finally {
    genLoading.value = false
  }
}

const testGeneratedRegex = () => {
  testForm.pattern = genResult.value
  testForm.testStrings = ''
  activeTab.value = 'test'
}

const explainGeneratedRegex = () => {
  explainForm.pattern = genResult.value
  activeTab.value = 'explain'
  handleExplain()
}

const handleClear = (type: 'gen' | 'test' | 'explain') => {
  if (type === 'gen') {
    genForm.description = ''
    genForm.testCasesStr = ''
    genResult.value = ''
  }
}

// ========== 实时测试 ==========
const testForm = reactive({
  pattern: '',
  flags: '',
  testStrings: '',
})
const testResult = ref<{
  valid: boolean
  pattern: string
  flags: string
  results: Array<{
    input: string
    matched: boolean
    matchGroups?: string[]
  }>
} | null>(null)

const handleTest = async () => {
  if (!testForm.pattern.trim()) {
    ElMessage.warning('请输入正则表达式')
    return
  }

  const testStrings = testForm.testStrings
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)

  try {
    const { data } = await validateRegexApi({
      pattern: testForm.pattern,
      flags: testForm.flags,
      testStrings: testStrings.length > 0 ? testStrings : undefined,
    })
    testResult.value = data
  } catch (e: any) {
    console.error('测试失败', e)
    ElMessage.error(e.message || '测试失败')
    // 本地测试作为降级方案
    testLocal()
  }
}

const testLocal = () => {
  try {
    const regex = new RegExp(testForm.pattern, testForm.flags)
    const lines = testForm.testStrings.split('\n').filter(s => s.trim())
    testResult.value = {
      valid: true,
      pattern: testForm.pattern,
      flags: testForm.flags,
      results: lines.map(line => {
        const match = regex.exec(line)
        return {
          input: line,
          matched: match !== null,
          matchGroups: match ? match.slice(1) : undefined,
        }
      }),
    }
  } catch (e: any) {
    ElMessage.error(`正则表达式错误: ${e.message}`)
  }
}

// ========== 语法解释 ==========
const explainLoading = ref(false)
const explainForm = reactive({
  pattern: '',
})
const explainResult = ref<{
  summary: string
  parts: Array<{ pattern: string; description: string }>
  examples: string[]
} | null>(null)

const handleExplain = async () => {
  if (!explainForm.pattern.trim()) {
    ElMessage.warning('请输入正则表达式')
    return
  }

  explainLoading.value = true
  try {
    const { data } = await explainRegexApi({ pattern: explainForm.pattern })
    explainResult.value = data.explanation
  } catch (e: any) {
    console.error('解释失败', e)
    ElMessage.error(e.message || '解释失败')
    // 本地解释作为降级
    explainLocal()
  } finally {
    explainLoading.value = false
  }
}

const explainLocal = () => {
  const pattern = explainForm.pattern
  const commonParts: Array<{ pattern: string; description: string }> = [
    { pattern: '\\d', description: '数字 [0-9]' },
    { pattern: '\\D', description: '非数字' },
    { pattern: '\\w', description: '单词字符 [a-zA-Z0-9_]' },
    { pattern: '\\W', description: '非单词字符' },
    { pattern: '\\s', description: '空白字符' },
    { pattern: '\\S', description: '非空白字符' },
    { pattern: '.', description: '任意字符（除换行）' },
    { pattern: '*', description: '零次或多次' },
    { pattern: '+', description: '一次或多次' },
    { pattern: '?', description: '零次或一次' },
    { pattern: '^', description: '字符串开始' },
    { pattern: '$', description: '字符串结束' },
  ]
  explainResult.value = {
    summary: `正则表达式用于匹配文本模式: ${pattern}`,
    parts: commonParts.filter(p => pattern.includes(p.pattern)),
    examples: [],
  }
}

// ========== 常用模板 ==========
const commonTemplates = [
  { name: '手机号码', pattern: '1[3-9]\\d{9}', desc: '匹配中国大陆手机号' },
  { name: '邮箱地址', pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', desc: '匹配常见邮箱格式' },
  { name: 'URL链接', pattern: 'https?://[\\w.-]+(?:/[\\w./-]*)?', desc: '匹配 HTTP/HTTPS URL' },
  { name: 'IP地址', pattern: '(?:\\d{1,3}\\.){3}\\d{1,3}', desc: '匹配 IPv4 地址' },
  { name: '日期YYYY-MM-DD', pattern: '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])', desc: 'ISO 日期格式' },
  { name: '日期YYYY/MM/DD', pattern: '\\d{4}/(?:0[1-9]|1[0-2])/(?:0[1-9]|[12]\\d|3[01])', desc: '斜杠分隔日期' },
  { name: '时间 HH:mm:ss', pattern: '(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d', desc: '24小时制时间' },
  { name: '身份证号', pattern: '[1-9]\\d{5}(?:19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]', desc: '中国大陆身份证' },
  { name: '中文字符', pattern: '[\\u4e00-\\u9fa5]+', desc: '匹配一个或多个中文字符' },
  { name: '空白行', pattern: '^\\s*$', desc: '匹配空行或仅包含空白字符的行' },
  { name: 'HTML标签', pattern: '<([a-z]+)([^<]+)*(?:>(.*)|/s*>)', desc: '匹配 HTML 标签' },
  { name: '文件路径', pattern: '(?:[a-zA-Z]:\\\\)?[\\w\\\\.]+', desc: '匹配 Windows 或 Unix 路径' },
]

const useTemplate = (tmpl: { name: string; pattern: string }) => {
  testForm.pattern = tmpl.pattern
  activeTab.value = 'test'
  ElMessage.success(`已加载模板: ${tmpl.name}`)
}

// ========== 工具函数 ==========
const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text).then(() => {
    ElMessage.success('已复制到剪贴板')
  }).catch(() => {
    ElMessage.error('复制失败')
  })
}
</script>

<style scoped>
.regex-tool-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--corp-text-primary);
}

.regex-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}

.tab-content {
  min-height: 400px;
}

.panel-section {
  background: #fafafa;
  border-radius: 8px;
  padding: 16px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--corp-text-primary);
  margin-bottom: 10px;
}

.section-title .hint {
  font-size: 12px;
  color: var(--corp-text-secondary);
  font-weight: normal;
}

.action-row {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.result-box {
  background: #fff;
  border-radius: 6px;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
}

.regex-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f5f7fa;
  padding: 10px 14px;
  border-radius: 4px;
  margin-bottom: 10px;
}

.regex-display code {
  font-family: 'Courier New', Consolas, monospace;
  font-size: 16px;
  color: #409eff;
  word-break: break-all;
}

.regex-actions {
  display: flex;
  gap: 8px;
}

/* 测试结果 */
.test-result {
  background: #fff;
  border-radius: 6px;
  padding: 12px;
}

.result-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 12px;
  font-size: 14px;
}

.result-summary.success {
  background: #f0f9eb;
  color: #67c23a;
}

.result-summary.error {
  background: #fef0f0;
  color: #f56c6c;
}

.match-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.match-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fafafa;
  border-radius: 4px;
  font-size: 13px;
}

.match-item code {
  flex: 1;
  font-family: 'Courier New', Consolas, monospace;
  color: var(--corp-text-primary);
  word-break: break-all;
}

.no-results {
  text-align: center;
  color: var(--corp-text-secondary);
  padding: 20px;
}

/* 解释结果 */
.explain-result {
  background: #fff;
  border-radius: 6px;
  padding: 12px;
}

.explain-summary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.6;
  margin-bottom: 12px;
}

.parts-title,
.examples-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--corp-text-secondary);
  margin-bottom: 8px;
}

.part-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.part-item {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}

.part-pattern {
  min-width: 80px;
  font-family: 'Courier New', Consolas, monospace;
  color: #409eff;
  background: #ecf5ff;
  padding: 2px 8px;
  border-radius: 3px;
}

.part-desc {
  color: var(--corp-text-primary);
}

.example-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 常用模板 */
.template-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.template-card {
  background: #fafafa;
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.template-card:hover {
  background: #fff;
  border-color: #409eff;
  box-shadow: 0 2px 12px rgba(64, 158, 255, 0.15);
  transform: translateY(-2px);
}

.template-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--corp-text-primary);
  margin-bottom: 6px;
}

.template-pattern {
  display: block;
  font-family: 'Courier New', Consolas, monospace;
  font-size: 12px;
  color: #409eff;
  background: #ecf5ff;
  padding: 6px 8px;
  border-radius: 4px;
  margin-bottom: 6px;
  word-break: break-all;
}

.template-desc {
  font-size: 11px;
  color: var(--corp-text-secondary);
}

/* 语法帮助 */
.syntax-help-card .card-title {
  font-size: 14px;
  font-weight: 500;
}

.syntax-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.syntax-row {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
}

.syntax-row code {
  min-width: 80px;
  font-family: 'Courier New', Consolas, monospace;
  color: #409eff;
  background: #ecf5ff;
  padding: 2px 8px;
  border-radius: 3px;
}

.syntax-row span {
  color: var(--corp-text-primary);
}

.regex-input-row {
  display: flex;
  gap: 8px;
}

.regex-input {
  flex: 1;
}

@media (max-width: 1200px) {
  .template-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 900px) {
  .template-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
