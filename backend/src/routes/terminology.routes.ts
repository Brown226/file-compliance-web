import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { TerminologyService } from '../services/terminology.service';

const router = Router();

// 所有术语接口都需要认证
router.use(authenticate);

/**
 * GET /api/terminology/categories
 * 获取术语分类列表（含各分类数量）
 */
router.get('/categories', async (_req: Request, res: Response) => {
  try {
    const categories = await TerminologyService.getCategories();
    const totalCount = await TerminologyService.getTermCount();
    res.json({ categories, totalCount });
  } catch (error: any) {
    res.status(500).json({ error: '获取术语分类失败', detail: error.message });
  }
});

/**
 * GET /api/terminology
 * 查询术语库（支持 ?q=xxx&category=xxx&page=1&pageSize=50）
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string) || '';
    const category = req.query.category as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 50;

    const result = await TerminologyService.listTerms({ query, category, page, pageSize });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: '查询术语库失败', detail: error.message });
  }
});

/**
 * POST /api/terminology
 * 新增术语（仅管理员/经理）
 */
router.post('/', requireRole('ADMIN', 'MANAGER'), async (req: Request, res: Response) => {
  try {
    const { term, category, aliases } = req.body;
    if (!term || !category) {
      res.status(400).json({ error: '术语名称和分类为必填项' });
      return;
    }
    const userId = (req as any).user?.id;
    const entry = await TerminologyService.addTerm({
      term,
      category,
      aliases: aliases || [],
      createdBy: userId,
    });
    res.status(201).json(entry);
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: '该术语在相同分类下已存在' });
      return;
    }
    res.status(500).json({ error: '新增术语失败', detail: error.message });
  }
});

/**
 * PUT /api/terminology/:id
 * 更新术语（仅管理员/经理）
 */
router.put('/:id', requireRole('ADMIN', 'MANAGER'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { term, category, aliases } = req.body;
    const entry = await TerminologyService.updateTerm(id, { term, category, aliases });
    res.json(entry);
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: '术语不存在' });
      return;
    }
    if (error.code === 'P2002') {
      res.status(409).json({ error: '该术语在相同分类下已存在' });
      return;
    }
    res.status(500).json({ error: '更新术语失败', detail: error.message });
  }
});

/**
 * DELETE /api/terminology/:id
 * 删除术语（仅管理员）
 */
router.delete('/:id', requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await TerminologyService.deleteTerm(id);
    res.json({ message: '删除成功' });
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: '术语不存在' });
      return;
    }
    res.status(500).json({ error: '删除术语失败', detail: error.message });
  }
});

/**
 * POST /api/terminology/batch
 * 批量新增术语（仅管理员/经理）
 */
router.post('/batch', requireRole('ADMIN', 'MANAGER'), async (req: Request, res: Response) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: '请提供术语列表' });
      return;
    }
    const userId = (req as any).user?.id;
    const result = await TerminologyService.batchAddTerms(
      items.map((item: any) => ({ ...item, createdBy: userId }))
    );
    res.json({ message: `成功添加 ${result.created} 个术语，跳过 ${result.skipped} 个重复`, ...result });
  } catch (error: any) {
    res.status(500).json({ error: '批量新增失败', detail: error.message });
  }
});

export default router;
