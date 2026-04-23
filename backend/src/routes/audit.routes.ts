import { Router } from 'express';
import { AuditController } from '../controllers/audit.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { auditLog } from '../middlewares/audit.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();
const auditController = new AuditController();

// Only admins can view audit logs
router.use(authenticate);
router.use(auditLog);

router.get('/', requireRole('ADMIN'), auditController.getLogs);
router.get('/export', requireRole('ADMIN'), auditController.exportLogs);

export default router;
