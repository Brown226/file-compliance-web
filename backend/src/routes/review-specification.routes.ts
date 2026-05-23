import express from 'express';
import {
  listSpecifications,
  getSpecification,
  createSpecification,
  updateSpecification,
  deleteSpecification,
  parseRulesFromFile,
  parseRulesPreview,
  importPreviewItems,
  addItem,
  updateItem,
  deleteItem,
} from '../controllers/review-specification.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import multer from 'multer';
import path from 'path';

const router = express.Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads/temp')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.use(authMiddleware);

router.get('/', listSpecifications);
router.get('/:id', getSpecification);
router.post('/', createSpecification);
router.put('/:id', updateSpecification);
router.delete('/:id', deleteSpecification);

router.post('/:id/parse', upload.single('file'), parseRulesFromFile);
router.post('/:id/parse-preview', upload.single('file'), parseRulesPreview);
router.post('/:id/import', importPreviewItems);

router.post('/:id/items', addItem);
router.put('/items/:itemId', updateItem);
router.delete('/items/:itemId', deleteItem);

export default router;