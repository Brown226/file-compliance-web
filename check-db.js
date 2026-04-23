const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  console.log('🔍 检查数据库中的 DWG 任务\n');
  
  const tasks = await p.task.findMany({
    where: { files: { some: { fileType: { equals: 'dwg', mode: 'insensitive' } } } },
    include: { files: true },
    orderBy: { createdAt: 'desc' },
    take: 2
  });
  
  if (tasks.length === 0) {
    console.log('❌ 未找到 DWG 任务');
    return;
  }
  
  for (const t of tasks) {
    console.log('='.repeat(60));
    console.log(`📋 任务: ${t.title}`);
    console.log(`   状态: ${t.status}`);
    console.log(`   ID: ${t.id}`);
    console.log();
    
    for (const f of t.files) {
      if (f.fileType?.toLowerCase() === 'dwg') {
        console.log('📄 DWG 文件:');
        console.log(`   文件名: ${f.fileName}`);
        console.log(`   大小: ${((f.fileSize || 0) / 1024 / 1024).toFixed(2)} MB`);
        
        const meta = f.dwgMetadata || {};
        console.log(`\n🔍 WASM 解析数据:`);
        console.log(`   dwg_wasm_parsed: ${meta.dwg_wasm_parsed}`);
        console.log(`   dwg_text_count: ${meta.dwg_text_count}`);
        console.log(`   dwg_dimension_count: ${meta.dwg_dimension_count}`);
        console.log(`   dwg_layers: ${meta.dwg_layers?.length || 0} 个图层`);
        console.log(`   layer_stats: ${meta.layer_stats ? '有' : '无'}`);
        console.log(`   title_block: ${meta.title_block ? '有' : '无'}`);
        
        if (meta.dwg_text_entities) {
          console.log(`\n📝 文本实体 (前5个):`);
          meta.dwg_text_entities.slice(0, 5).forEach((e, i) => {
            console.log(`   [${i+1}] "${e.text}" (图层: ${e.layer})`);
          });
        }
        
        const issues = await p.taskDetail.findMany({
          where: { taskId: t.id, fileId: f.id },
          select: { ruleCode: true, severity: true, issueType: true, description: true, originalText: true }
        });
        
        console.log(`\n📊 审查结果: ${issues.length} 条`);
        issues.forEach((issue, i) => {
          console.log(`   [${i+1}] ${issue.ruleCode || '(AI)'} | ${issue.severity}`);
          console.log(`       原文: ${(issue.originalText || '').substring(0, 60)}`);
        });
      }
    }
  }
}

main()
  .then(() => p.$disconnect())
  .catch(e => { console.error(e); p.$disconnect(); });
