import {
  buildingType,
  landUseType,
  structureType,
  climateZone,
} from '../data/keyInfoData'
import { PROJECT_FIELD_MAP } from '../data/constants'


// 中文数字转换
export const getChineseNumber = (num: number) => {
    const chineseNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  if (num <= 10) {
    return chineseNumbers[num - 1]
  }
  return num.toString()
}

// 智能字段映射函数
export const processRecognitionResult = (data: any, projectForm:any) => {
  console.log('识别结果:', data)
  
  // 如果返回的数据包含"项目特征类别"，则将其作为根节点
  const sourceData = data['项目特征类别'] ? data['项目特征类别'] : data

  // 创建字段映射配置
  const fieldMappings = {
    // 基本信息映射
    buildingName: {
      sources: ['使用功能.BuildingName', 'Function.BuildingName', 'BuildingName', 'buildingName'],
      processor: (value: string) => value
    },
    constructionUnit: {
      sources: ['建设单位', 'CompanyName', 'companyName'],
      processor: (value: string) => value
    },
    projectAddress: {
      sources: ['项目位置', 'ProjectLocation', 'projectLocation'],
      processor: (value: string) => value
    },
    
    // 规划条件映射
    landUseType: {
      sources: ['规划条件.UseType', 'PlanConditions.UseType', 'planConditions.useType'],
      processor: (value: string) => mapToOptionName(String(value), landUseType, ['教育用地', '住宅用地', '商业用地', '办公用地', '医疗用地', '工业用地'])
    },
    seismicIntensity: {
      sources: ['规划条件.sfIntensity', 'PlanConditions.sfIntensity', 'PlanConditions.SfIntensity', 'Site.SeismicIntensity', 'planConditions.sfIntensity'],
      processor: (value: any) => {
        const strVal = String(value)
        const match = strVal.match(/(\d+)度/)
        if (match) return match[1]
        if (/^\d+(\.\d+)?$/.test(strVal)) return strVal
        return null
      }
    },
    climateZone: {
      sources: ['规划条件.ClimateArea', 'Function.Area', 'PlanConditions.ClimateArea', 'planConditions.climateArea'],
      processor: (value: string) => mapToSelectValue(String(value), climateZone, ['寒冷地区', '严寒地区', '夏热冬冷地区', '夏热冬暖地区', '温和地区'])
    },
    
    // 建筑功能映射
    buildingType: {
      sources: ['使用功能.BuildingCategory', 'Function.BuildingCategory', 'BuildingCategory', 'buildingCategory'],
      processor: (value: string) => mapToSelectValue(String(value), buildingType, ['教育建筑', '住宅建筑', '商业建筑', '办公建筑', '医疗建筑', '工业建筑'])
    },
    buildingFunction: {
      sources: ['使用功能.Function', 'Function', 'function'],
      processor: (value: any) => {
        // 如果value是对象，尝试从中提取有用信息
        if (typeof value === 'object' && value !== null) {
            if (value.UseFunction) return value.UseFunction
            if (value.useFunction) return value.useFunction
            if (value.BuildingCategory) return value.BuildingCategory
            if (value.buildingCategory) return value.buildingCategory
            return null
        }
        
        // 如果value是对象（JSON字符串或对象），可能需要进一步处理，这里假设是字符串
        if (typeof value === 'string') {
           if (value.includes('教学楼')) return '教学楼'
           if (value.includes('宿舍楼')) return '宿舍楼'
           if (value.includes('办公楼')) return '办公楼'
        }
        return value
      }
    },
    
    // 结构信息映射
    structureType: {
      sources: ['主要建筑材料.Materials', 'Scale.StructureSystem', 'Structure.StructureType', 'KeyStructuralRequirements', 'StructureType', 'structureType'],
      processor: (value: any) => {
        if (typeof value === 'object' && value !== null) return null
        return mapToSelectValue(String(value), structureType, ['框架结构', '剪力墙结构', '框架-剪力墙结构', '钢结构', '砌体结构'])
      }
    },
    floors: {
      sources: ['建筑规模与形态', 'Scale.Floors', 'Scale', 'Floors', 'floors'],
      processor: (value: any) => {
        if (typeof value === 'object' && value !== null) {
          if (value.Floors) value = value.Floors
          else if (value.floors) value = value.floors
          else return null
        }

        // Ensure value is a string before processing
        value = String(value)
        if (value.includes('5层及以下')) return '5层及以下'
        const match = value.match(/(\d+)层/)
        return match ? `${match[1]}层` : value
      }
    },
    buildingHeight: {
      sources: ['建筑规模与形态', 'Scale.BuildingHeight', 'BuildingHeight', 'buildingHeight'],
      processor: (value: any) => {
        if (typeof value === 'object' && value !== null) {
           if (value.BuildingHeight) value = value.BuildingHeight
           else if (value.buildingHeight) value = value.buildingHeight
           else return null
        }
        value = String(value)
        if (value.includes('多层')) return '多层建筑'
        if (value === '多层公共建筑') return '多层建筑'
        return value
      }
    },
    
    // 安全等级映射
    structureDesignLife: {
      sources: ['安全等级.LifeLimit', 'LifeLimit', 'SafetyLevel.LifeLimit', 'lifeLimit'],
      processor: (value: any) => {
        if (typeof value === 'object' && value !== null) {
          if (value.LifeLimit) value = value.LifeLimit
          else if (value.lifeLimit) value = value.lifeLimit
          else return null
        }
        value = String(value)
        const match = value.match(/(\d+)年/)
        return match ? match[1] : null
      }
    },
    
    // 防火设计映射
    fireResistanceGrade: {
      sources: ['防火设计.FirePorcationClass', 'FireProtecionDesign.FirePorcationClass', 'fireProtecionDesign.firePorcationClass'],
      processor: (value: any) => {
        if (typeof value === 'object' && value !== null) return null
        value = String(value)
        const gradeMap: { [key: string]: string } = {
          '一级': '1', '二级': '2', '三级': '3', '四级': '4',
          'Class I': '1', 'Class II': '2', 'Class III': '3'
        }
        return gradeMap[value] || null
      }
    },
    fireCategory: {
      sources: ['建筑规模与形态', 'Scale.BuildingHeight', 'Scale', 'BuildingHeight', 'buildingHeight'],
      processor: (value: any) => {
        if (typeof value === 'object' && value !== null) {
          if (value.BuildingHeight) value = value.BuildingHeight
          else if (value.buildingHeight) value = value.buildingHeight
          else return null
        }
        value = String(value)
        if (value.includes('多层')) {
          return 'multi_story_public'
        } else if (value.includes('高层')) {
          return 'high_rise_public'
        }
        return null
      }
    },
    
    // 防水设计映射
    waterproofCategory: {
      sources: ['防水设计.WaterProofingCategory', 'WaterProofingDesign.WaterProofingCategory', 'WaterProofingDesign.WaterproofingEnvClass', 'waterProofingDesign.waterProofingCategory'],
      processor: (value: any) => {
        value = String(value)
        const categoryMap: { [key: string]: string } = {
          '甲类': '1', 'Ⅰ类': '1', 'Ⅱ类': '2', 'Ⅲ类': '3'
        }
        return categoryMap[value] || null
      }
    },
    waterproofGrade: {
      sources: ['防水设计.WaterProofingGrade', 'WaterProofingDesign.WaterProofingGrade', 'waterProofingDesign.waterProofingGrade'],
      processor: (value: any) => {
        value = String(value)
        if (value.includes('一级') || value.includes('一级防水')) return 'grade_1'
        if (value.includes('二级') || value.includes('二级防水')) return 'grade_2'
        if (value.includes('三级') || value.includes('三级防水')) return 'grade_3'
        return null
      }
    },
    
    // 地形地貌映射
    indoorOutdoorHeight: {
      sources: ['地形地貌.elevationDiff', 'ElevationDiff', 'Landform.elevationDiff', 'landform.elevationDiff'],
      processor: (value: any) => {
        value = String(value)
        return value === 'null' ? null : value
      }
    },
    absoluteElevation: {
      sources: ['地形地貌.absElevation', 'AbsElevation', 'Landform.absElevation', 'landform.absElevation'],
      processor: (value: any) => {
        value = String(value)
        return value === 'null' ? null : value
      }
    },
    
    // 材料信息映射
    buildingArea: {
      sources: ['使用功能.Area', 'Scale.Area', 'Function.Area', 'Area', 'area'],
      processor: (value: any) => {
        value = String(value)
        // 如果是面积数值，直接返回
        if (/\d+/.test(value) && !value.includes('地区')) {
          return value
        }
        return null
      }
    },
    energyEfficiencyRequirement: {
      sources: ['节能设计', 'EnergySavingDesign', 'energySavingDesign'],
      processor: (value: any) => {
        if (typeof value === 'string') return value
        if (value && typeof value === 'object') {
          // 优先提取 referenceStandards
          if (Array.isArray(value.referenceStandards)) {
            return value.referenceStandards.join('; ')
          }
          // 尝试提取其他可能包含信息的字段
          const parts: string[] = []
          if (value.energySavingStandard) parts.push(value.energySavingStandard)
          if (value.designStandard) parts.push(value.designStandard)
          
          if (parts.length > 0) return parts.join('; ')
          
          // 如果没有特定字段，尝试提取所有字符串或数组值
          const values: string[] = []
          Object.values(value).forEach(v => {
             if (typeof v === 'string') values.push(v)
             else if (Array.isArray(v)) values.push(v.join('; '))
          })
          if (values.length > 0) return values.join('; ')
        }
        return null
      }
    },
    barrierFreeRequirement: {
      sources: ['无障碍设计', 'BarrierFreeDesign', 'barrierFreeDesign'],
      processor: (value: any) => {
        if (typeof value === 'string') return value
        if (value && typeof value === 'object') {
          if (Array.isArray(value.referenceStandards)) {
            return value.referenceStandards.join('; ')
          }
           // 尝试提取其他可能包含信息的字段
          const parts: string[] = []
          if (value.barrierFreeStandard) parts.push(value.barrierFreeStandard)
          
          if (parts.length > 0) return parts.join('; ')

          // 如果没有特定字段，尝试提取所有字符串或数组值
          const values: string[] = []
          Object.values(value).forEach(v => {
             if (typeof v === 'string') values.push(v)
             else if (Array.isArray(v)) values.push(v.join('; '))
          })
          if (values.length > 0) return values.join('; ')
        }
        return null
      }
    }
  }
  
  // 执行字段映射
  let mappedCount = 0
  const mappedFields: string[] = []
  const mappedKeys: string[] = []
  
  Object.entries(fieldMappings).forEach(([fieldName, config]) => {
    let mappedValue = null
    
    // 尝试多个数据源
    for (const source of config.sources) {
      const value = getNestedValue(sourceData, source)
      if (value && value !== 'null' && value !== '') {
        mappedValue = config.processor(value)
        if (mappedValue !== null && mappedValue !== undefined) {
          break
        }
      }
    }
    
    // 如果成功映射，更新表单字段
    if (mappedValue !== null && mappedValue !== undefined) {
      // @ts-ignore
      projectForm.value[fieldName] = mappedValue

      mappedCount++
      mappedFields.push(getFieldDisplayName(fieldName))
      mappedKeys.push(fieldName)
    }
  })
  return {mappedCount,mappedFields, mappedKeys}
}

// 辅助函数：将文本值映射到选择框的value
const mapToSelectValue = (text: string, options: Array<{name: string, value: string}>, keywords: string[]): string | null => {
  if (!text) return null
  
  // 首先尝试精确匹配
  const exactMatch = options.find(option => option.name === text)
  if (exactMatch) return exactMatch.value
  
  // 然后尝试关键词匹配
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      const match = options.find(option => option.name.includes(keyword))
      if (match) return match.value
    }
  }
  
  return null
}


// 辅助函数：获取嵌套对象的值
const getNestedValue = (obj: any, path: string): any => {
  if (!obj) return null
  
  const keys = path.split('.')
  let current = obj
  
  for (const key of keys) {
    if (current === null || current === undefined) return null
    
    // 1. Try exact match
    if (current[key] !== undefined) {
      current = current[key]
      continue
    }
    
    // 2. Try case-insensitive match
    if (typeof current === 'object') {
      const foundKey = Object.keys(current).find(k => k.toLowerCase() === key.toLowerCase())
      if (foundKey) {
        current = current[foundKey]
        continue
      }
    }
    
    return null
  }
  
  return current
}

// 辅助函数：获取字段的显示名称
const getFieldDisplayName = (fieldName: string): string => {
  return PROJECT_FIELD_MAP[fieldName] || fieldName
}


export const resetProjectForm = ()=>{
  return {
    projectName: '',
    constructionUnit: '',
    designUnit: '',
    projectAddress: '',
    buildingArea: '',
    buildingHeight: '',
    buildingType: '',
    structureType: '',
    floors: '',
    undergroundFloors: '',
    projectDescription: '', // 项目概况
    // 新增字段的默认值
    landUseType: '',
    seismicIntensity: '',
    climateZone: '',
    indoorOutdoorHeight: '',
    absoluteElevation: '',
    buildingName: '',
    buildingFunction: '',
    plotRatioArea: '',
    structureDesignLife: '',
    fireResistanceGrade: '',
    fireCategory: '',
    waterproofCategory: '',
    waterproofGrade: '',
    roofWaterproofLife: '',
    energyEfficiencyRequirement: '',
    barrierFreeRequirement: '',
    professionTagId: undefined,
    businessTypeTagId: undefined
  }
}

const mapToOptionName = (text: string, options: Array<{name: string, value: string}>, keywords: string[]): string | null => {
  if (!text) return null
  const exactMatch = options.find(option => option.name === text)
  if (exactMatch) return exactMatch.name
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      const match = options.find(option => option.name.includes(keyword))
      if (match) return match.name
    }
  }
  return text
}