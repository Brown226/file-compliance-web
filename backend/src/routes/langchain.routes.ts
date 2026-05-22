import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import {
  langchainSearch,
  langchainHitTest,
  langchainAskQuestion,
  langchainAskStream,
  langchainReviewWithKnowledge,
} from '../controllers/langchain.controller';

const router = Router();

router.use(authenticate);

router.post('/search', langchainSearch);

router.post('/hit-test', langchainHitTest);

router.post('/ask', langchainAskQuestion);

router.post('/ask-stream', langchainAskStream);

router.post('/review', langchainReviewWithKnowledge);

export default router;
