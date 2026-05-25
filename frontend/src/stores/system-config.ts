import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getSystemConfigApi } from '@/api/system'

export const useSystemConfigStore = defineStore('systemConfig', () => {
  const systemName = ref('核审通')

  async function loadSystemName() {
    try {
      const { data } = await getSystemConfigApi('basic_settings')
      const v = typeof data?.value === 'string' ? JSON.parse(data.value) : (data?.value || {})
      if (v?.systemName && typeof v.systemName === 'string') {
        systemName.value = v.systemName
      }
    } catch {}
  }

  return { systemName, loadSystemName }
})
