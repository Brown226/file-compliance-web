
// 生成文档标签（提取3-4个关键字段）
export const generateDocumentTags = (projectInfo: any) => {
  const tags: Array<{name: string, type: string}> = []
  
  // 优先级字段映射（按重要性排序）
  const priorityFields = [
    { 
      key: 'buildingType', 
      label: '建筑类型', 
      type: 'primary',
      formatter: (value: string) => {
        // 处理选择框的值，转换为显示文本
        const buildingTypeMap: { [key: string]: string } = {
          'residential': '住宅建筑',
          'commercial': '商业建筑',
          'office': '办公建筑',
          'educational': '教育建筑',
          'medical': '医疗建筑',
          'industrial': '工业建筑'
        }
        return buildingTypeMap[value] || value
      }
    },
    { 
      key: 'structureType', 
      label: '结构类型', 
      type: 'warning',
      formatter: (value: string) => {
        const structureTypeMap: { [key: string]: string } = {
          'frame': '框架结构',
          'shear_wall': '剪力墙结构',
          'frame_shear_wall': '框架-剪力墙结构',
          'steel': '钢结构',
          'masonry': '砌体结构'
        }
        return structureTypeMap[value] || value
      }
    },
    { 
      key: 'floors', 
      label: '层数', 
      type: 'success', 
      formatter: (value: string) => {
        if (value.includes('层')) return value
        return `地上${value}层`
      }
    },
    { 
      key: 'buildingHeight', 
      label: '建筑高度', 
      type: 'info',
      formatter: (value: string) => {
        if (value.includes('多层')) return '多层建筑'
        if (value.includes('高层')) return '高层建筑'
        return value
      }
    },
    { 
      key: 'buildingArea', 
      label: '建筑面积', 
      type: 'success', 
      formatter: (value: string) => {
        if (value.includes('㎡') || value.includes('m²')) return value
        return `${value}㎡`
      }
    },
    { 
      key: 'fireResistanceGrade', 
      label: '耐火等级', 
      type: 'danger', 
      formatter: (value: string) => {
        if (value.includes('级')) return `${value}耐火`
        return `${value}级耐火`
      }
    },
    { 
      key: 'climateZone', 
      label: '气候分区', 
      type: 'info',
      formatter: (value: string) => {
        const climateZoneMap: { [key: string]: string } = {
          'cold': '寒冷地区',
          'severe_cold': '严寒地区',
          'hot_summer_cold_winter': '夏热冬冷地区',
          'hot_summer_warm_winter': '夏热冬暖地区',
          'temperate': '温和地区'
        }
        return climateZoneMap[value] || value
      }
    },
    { 
      key: 'seismicIntensity', 
      label: '抗震烈度', 
      type: 'warning', 
      formatter: (value: string) => {
        if (value.includes('度')) return `${value}抗震`
        return `${value}度抗震`
      }
    }
  ]
  
  // 从优先级字段中提取有值的字段作为标签
  let tagCount = 0
  const maxTags = 3

  for (const field of priorityFields) {
    if (tagCount >= maxTags) break

    const rawValue = projectInfo[field.key]
    // 确保值是字符串类型
    if (!rawValue || typeof rawValue !== 'string' || !rawValue.trim()) {
      continue
    }
    try {
      const displayValue = field.formatter ? field.formatter(rawValue) : rawValue
      tags.push({
        name: displayValue,
        type: field.type
      })
      tagCount++
    } catch (error) {
      console.warn(`处理字段 ${field.key} 时出错:`, error)
    }
  }
  
  // 如果标签不足4个，添加一些通用信息
  const buildingFunction = projectInfo.buildingFunction
  if (tagCount < maxTags && buildingFunction && typeof buildingFunction === 'string' && buildingFunction.trim()) {
    tags.push({
      name: buildingFunction,
      type: 'info'
    })
    tagCount++
  }

  // 如果还是不足，添加项目地址信息
  const projectAddress = projectInfo.projectAddress
  if (tagCount < maxTags && projectAddress && typeof projectAddress === 'string' && projectAddress.trim()) {
    const address = projectInfo.projectAddress.length > 10 
      ? projectInfo.projectAddress.substring(0, 10) + '...' 
      : projectInfo.projectAddress
    tags.push({
      name: address,
      type: 'info'
    })
    tagCount++
  }
  
  return tags
}