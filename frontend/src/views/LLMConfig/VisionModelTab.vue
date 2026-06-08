<template>
  <div class="engine-tab">
    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px">
      <template #title>多模态视觉模型 — 扫描件 OCR</template>
      扫描件 PDF 和图片的文字识别通过视觉大模型完成。配置 API 密钥和模型后即可识别扫描件。
    </el-alert>
    <section class="config-section">
      <div class="config-card">
        <el-form :model="config" label-width="120px">
          <el-form-item label="API 密钥">
            <el-input v-model="config.apiKey" type="password" placeholder="sk-..." show-password clearable />
          </el-form-item>
          <el-form-item label="API URL">
            <el-input v-model="config.apiBaseUrl" placeholder="https://api.siliconflow.cn/v1" clearable />
          </el-form-item>
          <el-form-item label="视觉模型">
            <el-select v-model="config.modelName" placeholder="选择视觉模型" filterable allow-create style="width: 100%">
              <el-option v-for="m in visionModels" :key="m" :label="m" :value="m" />
            </el-select>
          </el-form-item>
          <el-form-item label="超时"><el-input-number v-model="config.timeout" :min="30" :max="300" /> 秒</el-form-item>
        </el-form>
      </div>
      <div class="action-bar">
        <el-button @click="handleTest" :loading="tl" class="test-btn">测试连接</el-button>
        <el-button type="primary" :loading="sl" @click="handleSave">保存配置</el-button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getSystemConfigApi, saveSystemConfigApi, testLlmConnectionApi } from '@/api/system'
const sl = ref(false), tl = ref(false)
const visionModels = ['Qwen/Qwen2-VL-72B-Instruct','Qwen/Qwen2.5-VL-72B-Instruct','Qwen/Qwen3-VL-72B-Instruct','deepseek-ai/DeepSeek-VL2-72B','THUDM/glm-4v-9b']
const config = reactive({apiKey:'',apiBaseUrl:'https://api.siliconflow.cn/v1',modelName:'',timeout:180})
const orig = ref('')
const changed = computed(() => JSON.stringify(config) !== orig.value)
const handleTest = async () => { if(!config.apiKey){ElMessage.warning('请输入API密钥');return} tl.value=true; try{ const r = await testLlmConnectionApi({serviceType:'siliconflow',apiKey:config.apiKey,apiBaseUrl:config.apiBaseUrl,modelName:config.modelName,modelType:'chat'}); r.data.success?ElMessage.success('通过'):ElMessage.error(r.data.message) }catch(e:any){ElMessage.error(e.message)} finally{tl.value=false} }
const handleSave = async () => { sl.value=true; try{await saveSystemConfigApi('llm_vision_model',config);orig.value=JSON.stringify(config);ElMessage.success('已保存')}catch(e:any){ElMessage.error(e.response?.data?.error||e.message)} finally{sl.value=false} }
onMounted(async () => { try{ const { data } = await getSystemConfigApi('llm_vision_model'); let v = data?.value||data; if(typeof v==='string')v=JSON.parse(v); if(v&&typeof v==='object'){Object.keys(config).forEach(k=>{if(k in v&&v[k]!==undefined)(config as any)[k]=v[k]})} orig.value=JSON.stringify(config) }catch(_){} })
defineExpose({ get hasUnsavedChanges(){return changed.value}, get summary(){return [{label:'视觉模型',value:config.modelName||'未配置'}]} })
</script>

<style scoped>
.engine-tab{display:flex;flex-direction:column;gap:18px}
.config-section{display:flex;flex-direction:column;gap:18px}
.config-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px}
.action-bar{display:flex;justify-content:flex-end;gap:10px}
.test-btn{border-color:#2563eb;color:#2563eb;background:transparent}
.test-btn:hover{background:#eff6ff}
</style>
