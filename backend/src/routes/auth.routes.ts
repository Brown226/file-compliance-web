import { Router } from 'express';
import { login, logout, changePassword, changeUsername } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { loginRateLimit } from '../middlewares/rate-limit.middleware';

const router = Router();

router.post('/login', loginRateLimit, login);
router.post('/logout', authenticate, logout);
router.post('/change-password', authenticate, changePassword);
router.post('/change-username', authenticate, changeUsername);

export default router;
