import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import {
  getHistory,
  listSessions,
  createSession,
  deleteSession,
  askStream,
} from '../controllers/qa.controller';

const router = Router();

router.use(authenticate);

router.get('/sessions', listSessions);
router.post('/sessions', createSession);
router.delete('/sessions/:sessionId', deleteSession);
router.get('/sessions/:sessionId/history', getHistory);
router.post('/ask-stream', askStream);

export default router;
