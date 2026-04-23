import { Router } from 'express';
import { employeeController } from '../controllers/employee.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

// Apply authentication middleware to all employee routes
router.use(authenticate);

// Get all employees - all authenticated users can view (filtered by role in controller)
router.get('/', employeeController.getEmployees);

// Get single employee by ID
router.get('/:id', employeeController.getEmployeeById);

// Create/Update/Delete employee - admin only
router.post('/', requireRole('ADMIN'), employeeController.createEmployee);
router.put('/:id', requireRole('ADMIN'), employeeController.updateEmployee);
router.delete('/:id', requireRole('ADMIN'), employeeController.deleteEmployee);

// Batch operations - admin only
router.post('/batch-create', requireRole('ADMIN'), employeeController.batchCreateEmployees);
router.post('/batch-update-status', requireRole('ADMIN'), employeeController.batchUpdateStatus);
router.post('/batch-delete', requireRole('ADMIN'), employeeController.batchDeleteEmployees);
router.post('/reset-password/:id', requireRole('ADMIN'), employeeController.resetPassword);

export default router;
