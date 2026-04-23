import { Router } from 'express'
import { authenticate } from '../middlewares/auth.middleware'
import { requireRole } from '../middlewares/rbac.middleware'
import {
  generateRegex,
  explainRegex,
  validateRegex,
} from '../controllers/regex.controller'

const router = Router()

// 所有路由需要认证
router.use(authenticate)

// POST /api/regex/generate — AI 生成正则表达式
router.post('/generate', requireRole('ADMIN'), generateRegex)

// POST /api/regex/explain — 解释正则表达式
router.post('/explain', requireRole('ADMIN'), explainRegex)

// POST /api/regex/validate — 验证正则表达式
router.post('/validate', requireRole('ADMIN'), validateRegex)

export default router
