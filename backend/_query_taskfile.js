const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.taskFile.findMany({
  take: 10,
  select: { id: true, fileName: true, filePath: true }
}).then(r => {
  console.log(JSON.stringify(r, null, 2));
  p.$disconnect();
}).catch(e => {
  console.error(e);
  p.$disconnect();
});
