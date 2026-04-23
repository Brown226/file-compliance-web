import request from '@/utils/request'

export function getPipelineStepsApi() {
  return request.get('/pipeline/steps')
}

export function createPipelineStepApi(data: any) {
  return request.post('/pipeline/steps', data)
}

export function updatePipelineStepApi(id: string, data: any) {
  return request.patch(`/pipeline/steps/${id}`, data)
}

export function deletePipelineStepApi(id: string) {
  return request.delete(`/pipeline/steps/${id}`)
}

export function reorderPipelineStepsApi(steps: { id: string; order: number }[]) {
  return request.post('/pipeline/steps/reorder', { steps })
}

export function getTimeoutConfigApi() {
  return request.get('/pipeline/timeout-config')
}

export function saveTimeoutConfigApi(config: any) {
  return request.put('/pipeline/timeout-config', config)
}

export function resetPipelineApi() {
  return request.post('/pipeline/reset')
}
