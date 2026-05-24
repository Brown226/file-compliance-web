import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import {
  langchainSearch,
  langchainHitTest,
  langchainAskQuestion,
  langchainAskStream,
  langchainReviewWithKnowledge,
  getConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  saveMessage,
  langchainAskBackground,
  getMessageStatus,
  getMessagesStatus,
} from '../controllers/langchain.controller';

const router = Router();

router.use(authenticate);

// 问答相关
router.post('/search', langchainSearch);
router.post('/hit-test', langchainHitTest);
router.post('/ask', langchainAskQuestion);
router.post('/ask-stream', langchainAskStream);
router.post('/review', langchainReviewWithKnowledge);
router.post('/ask-background', langchainAskBackground);

// 消息状态查询
router.get('/messages/:messageId/status', getMessageStatus);
router.post('/messages/status', getMessagesStatus);

// 对话记录管理
router.get('/conversations', getConversations);
router.get('/conversations/:id', getConversation);
router.post('/conversations', createConversation);
router.put('/conversations/:id', updateConversation);
router.delete('/conversations/:id', deleteConversation);
router.post('/conversations/:sessionId/messages', saveMessage);

export default router;
