// backend/scripts/eval-maxkb-chunks.ts
// 用法: npx tsx scripts/eval-maxkb-chunks.ts <knowledgeId> [sampleSize]
// 拉取指定 MaxKB 知识库的全部 chunks，抽样评估切分质量，决定走路线 1（复用 MaxKB 切分）还是路线 2（自建切分）。

import { MaxKBService } from '../src/services/knowledge/maxkb.service';

interface ChunkEval {
  chunkId: string;
  content: string;
  documentName: string;
  // 评估维度
  isCompleteClause: boolean;   // 是否完整包含一条条文（不切断）
  hasClauseCode: boolean;      // 是否含条文编号（如 "5.2.3"）
  isReasonableSize: boolean;   // 粒度合理（100-2000 字）
  clauseCodeDetected?: string; // 检测到的条文编号
  contentLength: number;
  preview: string;             // 前 100 字
}

/**
 * 启发式判断：是否完整条文（不以句号中间切断，有明确起止）
 */
function judgeCompleteClause(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 50) return false;
  // 简单启发：以条文编号开头或以句号结尾
  const startsWithCode = /^\d+\.\d+/.test(trimmed);
  const endsWithPeriod = /[。.；;]$/.test(trimmed);
  return startsWithCode || endsWithPeriod;
}

async function main() {
  const knowledgeId = process.argv[2];
  const sampleSize = parseInt(process.argv[3] || '30', 10);

  if (!knowledgeId) {
    console.error('用法: npx tsx scripts/eval-maxkb-chunks.ts <knowledgeId> [sampleSize]');
    console.error('示例: npx tsx scripts/eval-maxkb-chunks.ts abc123 30');
    process.exit(1);
  }

  console.log(`[评估] 拉取知识库 ${knowledgeId} 的全部 chunks...`);

  const workspaceId = await MaxKBService.getDefaultWorkspaceId();

  // 拉取知识库下所有文档
  const documents = await (MaxKBService as any).adminRequest(
    'GET',
    `/workspace/${workspaceId}/knowledge/${knowledgeId}/document/1/100`,
  );
  const docList = (documents as any)?.records || (documents as any)?.data || [];
  console.log(`[评估] 知识库有 ${docList.length} 个文档`);

  if (docList.length === 0) {
    console.error('[评估] 知识库无文档，终止');
    process.exit(1);
  }

  // 拉取每个文档的段落（chunk）
  const allChunks: Array<{ id: string; content: string; documentName: string }> = [];
  for (const doc of docList) {
    const docId = doc.id || doc.document_id;
    const docName = doc.name || doc.document_name || '未知';
    try {
      const paragraphsResp = await (MaxKBService as any).adminRequest(
        'GET',
        `/workspace/${workspaceId}/knowledge/${knowledgeId}/document/${docId}/paragraph/1/500`,
      );
      const paras = (paragraphsResp as any)?.records || (paragraphsResp as any)?.data || [];
      for (const p of paras) {
        allChunks.push({
          id: p.id || '',
          content: p.content || '',
          documentName: docName,
        });
      }
    } catch (e) {
      console.warn(`[评估] 拉取文档 ${docId}(${docName}) 段落失败:`, (e as Error).message);
    }
  }

  console.log(`[评估] 共拉取 ${allChunks.length} 个 chunks`);

  if (allChunks.length === 0) {
    console.error('[评估] 无 chunks，终止');
    process.exit(1);
  }

  // 抽样
  const sample = allChunks.length <= sampleSize
    ? allChunks
    : [...allChunks].sort(() => Math.random() - 0.5).slice(0, sampleSize);

  console.log(`[评估] 抽样 ${sample.length} 个 chunks 评估`);

  // 评估每个 chunk
  const evals: ChunkEval[] = sample.map(chunk => {
    const content = chunk.content || '';
    const clauseCodeMatch = content.match(/(\d+\.\d+(?:\.\d+)?)/);
    const clauseCode = clauseCodeMatch ? clauseCodeMatch[1] : undefined;
    return {
      chunkId: chunk.id,
      content,
      documentName: chunk.documentName,
      isCompleteClause: judgeCompleteClause(content),
      hasClauseCode: !!clauseCode,
      isReasonableSize: content.length >= 100 && content.length <= 2000,
      clauseCodeDetected: clauseCode,
      contentLength: content.length,
      preview: content.substring(0, 100),
    };
  });

  // 统计
  const total = evals.length;
  const completeCount = evals.filter(e => e.isCompleteClause).length;
  const hasCodeCount = evals.filter(e => e.hasClauseCode).length;
  const reasonableSizeCount = evals.filter(e => e.isReasonableSize).length;
  const allPassCount = evals.filter(e => e.isCompleteClause && e.hasClauseCode && e.isReasonableSize).length;

  // 综合合格率：3 个维度至少满足 2 个
  const qualifiedCount = evals.filter(e => {
    const score = [e.isCompleteClause, e.hasClauseCode, e.isReasonableSize].filter(Boolean).length;
    return score >= 2;
  }).length;

  const qualifiedRate = (qualifiedCount / total * 100).toFixed(1);

  console.log('\n========== MaxKB 切分质量评估报告 ==========');
  console.log(`知识库 ID: ${knowledgeId}`);
  console.log(`总 chunks 数: ${allChunks.length}`);
  console.log(`抽样数: ${total}`);
  console.log(`\n--- 维度统计 ---`);
  console.log(`完整条文: ${completeCount}/${total} (${(completeCount / total * 100).toFixed(1)}%)`);
  console.log(`含条文编号: ${hasCodeCount}/${total} (${(hasCodeCount / total * 100).toFixed(1)}%)`);
  console.log(`粒度合理(100-2000字): ${reasonableSizeCount}/${total} (${(reasonableSizeCount / total * 100).toFixed(1)}%)`);
  console.log(`三维度全过: ${allPassCount}/${total} (${(allPassCount / total * 100).toFixed(1)}%)`);
  console.log(`\n--- 综合合格率（3 维度满足 ≥2）---`);
  console.log(`合格: ${qualifiedCount}/${total} (${qualifiedRate}%)`);
  console.log(`\n--- go/no-go 判定 ---`);
  console.log(`阈值: 80%`);
  console.log(`实际: ${qualifiedRate}%`);
  console.log(qualifiedCount / total >= 0.8
    ? '✅ GO：走路线 1（复用 MaxKB 切分 + 加工层）'
    : '❌ NO-GO：转路线 2（自建条文切分）');

  console.log(`\n--- 抽样明细（前 10 条）---`);
  for (const e of evals.slice(0, 10)) {
    console.log(`\n[${e.chunkId}] ${e.documentName} (len=${e.contentLength})`);
    console.log(`  编号: ${e.clauseCodeDetected || '未检测到'}`);
    console.log(`  完整:${e.isCompleteClause} 编号:${e.hasClauseCode} 粒度:${e.isReasonableSize}`);
    console.log(`  预览: ${e.preview}...`);
  }

  // 输出完整明细到文件
  const fs = await import('fs/promises');
  const path = await import('path');
  const reportPath = path.resolve(process.cwd(), `maxkb-chunks-eval-${knowledgeId.substring(0, 8)}-${Date.now()}.json`);
  await fs.writeFile(reportPath, JSON.stringify(evals, null, 2), 'utf-8');
  console.log(`\n[评估] 完整明细已写入: ${reportPath}`);

  // prisma 在脚本场景下不会自动断开，显式退出
  process.exit(0);
}

main().catch(e => {
  console.error('[评估] 失败:', e);
  process.exit(1);
});
