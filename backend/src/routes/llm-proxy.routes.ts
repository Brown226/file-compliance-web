import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import {
  proxyChatCompletions,
  proxyEmbeddings,
  proxyRerank,
  getProxyStatus,
  testProxyConnection,
} from '../controllers/llm-proxy.controller';

const router = Router();

router.use(authenticate);

router.post('/chat/completions', proxyChatCompletions);

router.post('/embeddings', proxyEmbeddings);

router.post('/rerank', proxyRerank);

router.get('/status', getProxyStatus);

router.post('/test', requireRole('ADMIN'), testProxyConnection);

export default router;