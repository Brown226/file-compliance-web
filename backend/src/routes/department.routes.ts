import { Router } from 'express';
import { departmentController } from '../controllers/department.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

// Apply authentication middleware to all department routes
router.use(authenticate);

// Get department tree - all authenticated users can view
router.get('/', departmentController.getDepartmentsTree);

// Create/Update/Delete department - admin only
router.post('/', requireRole('ADMIN'), departmentController.createDepartment);
router.put('/:id', requireRole('ADMIN'), departmentController.updateDepartment);
router.delete('/:id', requireRole('ADMIN'), departmentController.deleteDepartment);

export default router;
