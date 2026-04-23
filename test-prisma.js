const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
console.log('taskFile exists:', !!p.taskFile);
console.log('Models:', Object.keys(p).filter(k => !k.startsWith('_')));
p.$disconnect();
