import { Embeddings, EmbeddingsParams } from '@langchain/core/embeddings';
import { EmbeddingService } from '../../services/embedding.service';

export class SystemConfigEmbeddings extends Embeddings {
  lc_serializable = false;

  constructor(params?: EmbeddingsParams) {
    super(params ?? {});
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return EmbeddingService.embedTexts(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    return EmbeddingService.embedText(text);
  }
}
