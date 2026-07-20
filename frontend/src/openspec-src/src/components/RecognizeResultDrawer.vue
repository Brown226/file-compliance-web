<template>
  <el-drawer :model-value="modelValue" @update:modelValue="val => emit('update:modelValue', val)" title="识别结果" size="520px" direction="rtl">
    <div class="drawer-details">
      <div class="project-sections">
        <div class="section"><div class="section-title">规划条件</div>
          <el-form label-position="left" label-width="140px" class="drawer-form">
            <el-form-item label="土地使用性质">
              <el-input v-model="wizardForm.landUseType" placeholder="请输入土地使用性质" maxlength="50" clearable @clear="handleClear('landUseType')" :class="{ 'recognized-control': isRecognized('landUseType') }" />
            </el-form-item>
            <el-form-item label="抗震设防烈度">
              <el-select v-model="wizardForm.seismicIntensity" placeholder="请选择" style="width: 100%" clearable @clear="handleClear('seismicIntensity')" :class="{ 'recognized-control': isRecognized('seismicIntensity') }">
                <el-option v-for="item in seismicIntensity" :key="item.value" :label="item.name" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="建筑气候分区">
              <el-select v-model="wizardForm.climateZone" placeholder="请选择" style="width: 100%" clearable @clear="handleClear('climateZone')" :class="{ 'recognized-control': isRecognized('climateZone') }">
                <el-option v-for="item in climateZone" :key="item.value" :label="item.name" :value="item.value" />
              </el-select>
            </el-form-item>
          </el-form>
        </div>

        <div class="section"><div class="section-title">地形地貌</div>
          <el-form label-position="left" label-width="140px" class="drawer-form">
            <el-form-item label="室内外高差">
              <el-input v-model="wizardForm.indoorOutdoorHeight" placeholder="如：900mm (1#楼)" maxlength="20" clearable @clear="handleClear('indoorOutdoorHeight')" :class="{ 'recognized-control': isRecognized('indoorOutdoorHeight') }" />
            </el-form-item>
            <el-form-item label="绝对标高">
              <el-input v-model="wizardForm.absoluteElevation" placeholder="如：36.60m (1#楼)" maxlength="20" clearable @clear="handleClear('absoluteElevation')" :class="{ 'recognized-control': isRecognized('absoluteElevation') }" />
            </el-form-item>
          </el-form>
        </div>

        <div class="section"><div class="section-title">使用功能</div>
          <el-form label-position="left" label-width="140px" class="drawer-form">
            <el-form-item label="建筑类别">
              <el-select v-model="wizardForm.buildingType" placeholder="请选择" style="width: 100%" clearable @clear="handleClear('buildingType')" :class="{ 'recognized-control': isRecognized('buildingType') }">
                <el-option v-for="item in buildingType" :key="item.value" :label="item.name" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="建筑名称">
              <el-input v-model="wizardForm.buildingName" placeholder="如：保税区第一高中教学楼" maxlength="50" clearable @clear="handleClear('buildingName')" :class="{ 'recognized-control': isRecognized('buildingName') }" />
            </el-form-item>
            <el-form-item label="使用功能">
              <el-input v-model="wizardForm.buildingFunction" placeholder="如：宿舍、食堂、教学楼" maxlength="50" clearable @clear="handleClear('buildingFunction')" :class="{ 'recognized-control': isRecognized('buildingFunction') }" />
            </el-form-item>
            <el-form-item label="建筑规模">
              <el-input v-model="wizardForm.buildingArea" placeholder="如：1#楼建筑面积 5772.59m²" maxlength="50" clearable @clear="handleClear('buildingArea')" :class="{ 'recognized-control': isRecognized('buildingArea') }" />
            </el-form-item>
            <el-form-item label="计容面积">
              <el-input v-model="wizardForm.plotRatioArea" placeholder="如：5772.59m²" maxlength="20" clearable @clear="handleClear('plotRatioArea')" :class="{ 'recognized-control': isRecognized('plotRatioArea') }" />
            </el-form-item>
          </el-form>
        </div>

        <div class="section"><div class="section-title">建筑规模与形态</div>
          <el-form label-position="left" label-width="140px" class="drawer-form">
            <el-form-item label="地上层数">
              <el-input v-model="wizardForm.floors" placeholder="如：1#楼为 5/2 层" maxlength="20" clearable @clear="handleClear('floors')" :class="{ 'recognized-control': isRecognized('floors') }" />
            </el-form-item>
            <el-form-item label="建筑高度">
              <el-input v-model="wizardForm.buildingHeight" placeholder="如：22.375m (1#楼，消防高度)" maxlength="30" clearable @clear="handleClear('buildingHeight')" :class="{ 'recognized-control': isRecognized('buildingHeight') }" />
            </el-form-item>
            <el-form-item label="主要结构造型">
              <el-select v-model="wizardForm.structureType" placeholder="请选择" style="width: 100%" clearable @clear="handleClear('structureType')" :class="{ 'recognized-control': isRecognized('structureType') }">
                <el-option v-for="item in structureType" :key="item.value" :label="item.name" :value="item.value" />
              </el-select>
            </el-form-item>
          </el-form>
        </div>

        <div class="section"><div class="section-title">安全等级</div>
          <el-form label-position="left" label-width="140px" class="drawer-form">
            <el-form-item label="结构设计使用年限">
              <el-select v-model="wizardForm.structureDesignLife" placeholder="请选择" style="width: 100%" clearable @clear="handleClear('structureDesignLife')" :class="{ 'recognized-control': isRecognized('structureDesignLife') }">
                <el-option v-for="item in structureDesignLife" :key="item.value" :label="item.name" :value="item.value" />
              </el-select>
            </el-form-item>
          </el-form>
        </div>

        <div class="section"><div class="section-title">防火设计</div>
          <el-form label-position="left" label-width="140px" class="drawer-form">
            <el-form-item label="耐火等级">
              <el-select v-model="wizardForm.fireResistanceGrade" placeholder="请选择" style="width: 100%" clearable @clear="handleClear('fireResistanceGrade')" :class="{ 'recognized-control': isRecognized('fireResistanceGrade') }">
                <el-option v-for="item in fireResistanceGrade" :key="item.value" :label="item.name" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="防火类别">
              <el-select v-model="wizardForm.fireCategory" placeholder="请选择" style="width: 100%" clearable @clear="handleClear('fireCategory')" :class="{ 'recognized-control': isRecognized('fireCategory') }">
                <el-option v-for="item in fireCategory" :key="item.value" :label="item.name" :value="item.value" />
              </el-select>
            </el-form-item>
          </el-form>
        </div>

        <div class="section"><div class="section-title">防水设计</div>
          <el-form label-position="left" label-width="140px" class="drawer-form">
            <el-form-item label="防水类别">
              <el-select v-model="wizardForm.waterproofCategory" placeholder="请选择" style="width: 100%" clearable @clear="handleClear('waterproofCategory')" :class="{ 'recognized-control': isRecognized('waterproofCategory') }">
                <el-option label="Ⅰ类" value="1" />
                <el-option label="Ⅱ类" value="2" />
                <el-option label="Ⅲ类" value="3" />
              </el-select>
            </el-form-item>
            <el-form-item label="屋面防水合理使用年限">
              <el-input v-model="wizardForm.roofWaterproofLife" placeholder="如：不小于 20 年" maxlength="20" clearable @clear="handleClear('roofWaterproofLife')" :class="{ 'recognized-control': isRecognized('roofWaterproofLife') }" />
            </el-form-item>
            <el-form-item label="防水等级">
              <el-select v-model="wizardForm.waterproofGrade" placeholder="请选择" style="width: 100%" clearable @clear="handleClear('waterproofGrade')" :class="{ 'recognized-control': isRecognized('waterproofGrade') }">
                <el-option label="一级防水（地下、室内卫生间）" value="grade_1" />
                <el-option label="二级防水" value="grade_2" />
                <el-option label="三级防水" value="grade_3" />
              </el-select>
            </el-form-item>
          </el-form>
        </div>

        <div class="section"><div class="section-title">节能设计</div>
          <el-form label-position="left" label-width="140px" class="drawer-form">
            <el-form-item label="节能要求">
              <el-input v-model="wizardForm.energyEfficiencyRequirement" type="textarea" :rows="3" placeholder="如：有明确节能要求，引用《建筑节能与可再生能源利用通用规范》GB55015-2021，但具体节能率及K值未见" maxlength="200" clearable @clear="handleClear('energyEfficiencyRequirement')" :class="{ 'recognized-control': isRecognized('energyEfficiencyRequirement') }" />
            </el-form-item>
          </el-form>
        </div>

        <div class="section"><div class="section-title">无障碍设计</div>
          <el-form label-position="left" label-width="140px" class="drawer-form">
            <el-form-item label="无障碍要求">
              <el-input v-model="wizardForm.barrierFreeRequirement" type="textarea" :rows="3" placeholder="如：有明确无障碍要求，引用《无障碍设计规范》GB50763-2012 及《建筑与市政工程无障碍通用规范》GB55019-2021" maxlength="200" clearable @clear="handleClear('barrierFreeRequirement')" :class="{ 'recognized-control': isRecognized('barrierFreeRequirement') }" />
            </el-form-item>
          </el-form>
        </div>
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
  import { buildingType, climateZone, structureType, structureDesignLife, fireResistanceGrade, fireCategory, seismicIntensity } from '../data/keyInfoData'

  interface WizardForm {
    landUseType?: string
    seismicIntensity?: string
    climateZone?: string
    indoorOutdoorHeight?: string
    absoluteElevation?: string
    buildingType?: string
    buildingName?: string
    buildingFunction?: string
    buildingArea?: string
    plotRatioArea?: string
    floors?: string
    buildingHeight?: string
    structureType?: string
    structureDesignLife?: string
    fireResistanceGrade?: string
    fireCategory?: string
    waterproofCategory?: string
    roofWaterproofLife?: string
    waterproofGrade?: string
    energyEfficiencyRequirement?: string
    barrierFreeRequirement?: string
  }

  const props = defineProps<{ modelValue: boolean; wizardForm: WizardForm; recognizedFields: Record<string, any> }>()
  const emit = defineEmits<{ 'update:modelValue': [value: boolean]; 'clear-field': [key: string] }>()

  const isRecognized = (key: string) => {
    const rf = props.recognizedFields?.[key]
    return !!rf && rf.status !== 'rejected'
  }

  const handleClear = (key: string) => {
    emit('clear-field', key)
  }
</script>

<style scoped>
.drawer-details {
  margin-top: 12px;
}

.drawer-form {
  padding-top: 4px;
}

.drawer-form :deep(.el-form-item) {
  margin-bottom: 8px;
}

.drawer-form :deep(.el-form-item__label) {
  font-size: 13px;
  color: var(--gray-700);
  white-space: nowrap;
}

.drawer-form :deep(.el-input),
.drawer-form :deep(.el-select),
.drawer-form :deep(.el-textarea) {
  width: 100%;
}

.recognized-control :deep(.el-input__wrapper),
.recognized-control :deep(.el-select__wrapper) {
  background-color: #f0f9eb;
  border-color: #67C23A;
}

.recognized-control :deep(.el-input__inner),
.recognized-control :deep(.el-select__selected-item) {
  color: #3ba776;
}

.recognized-control :deep(textarea.el-textarea__inner) {
  background-color: #f0f9eb;
  border-color: #67C23A;
  color: #3ba776;
}

.project-sections {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--gray-700);
  margin: 6px 0 4px;
}

.section-title {
  margin: 0 0 16px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--gray-800);
  padding-bottom: 8px;
  border-bottom: 2px solid var(--primary-color);
  display: inline-block;
}

.review-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
</style>
