import { PrismaClient } from '@prisma/client';

// 显式配置连接池：避免高并发 DB 写入时连接池耗尽触发事务重试
// 仅当 DATABASE_URL 未自带 connection_limit 时追加参数
const baseUrl = process.env.DATABASE_URL || '';
const hasPoolParam = baseUrl.includes('connection_limit=');
const dbUrl = hasPoolParam ? baseUrl : `${baseUrl}?connection_limit=20&pool_timeout=10`;

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl,
    },
  },
});

export default prisma;
