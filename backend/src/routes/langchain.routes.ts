import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import {
  langchainSearch,
  langchainHitTest,
  langchainAskQuestion,
  langchainAskStream,
  langchainReviewWithKnowledge,
  compareReviewWithKnowledge,
} from '../controllers/langchain.controller';

const router = Router();

router.use(authenticate);

router.post('/search', langchainSearch);

router.post('/hit-test', langchainHitTest);

router.post('/ask', langchainAskQuestion);

router.post('/ask-stream', langchainAskStream);

router.post('/review', langchainReviewWithKnowledge);
router.post('/review-compare', compareReviewWithKnowledge);

export default router;
