import { Router } from 'express'
import FalsePositiveLibraryController from '../controllers/falsePositiveLibrary.controller'
import { authenticate } from '../middlewares/auth.middleware'

const router = Router()

// 所有路由都需要认证
router.use(authenticate)

// 获取误报标记库列表
router.get('/', FalsePositiveLibraryController.list)

// 获取统计信息
router.get('/stats', FalsePositiveLibraryController.stats)

// 导出误报标记库
router.get('/export', FalsePositiveLibraryController.export)

// 删除记录
router.delete('/:id', FalsePositiveLibraryController.delete)

export default router
