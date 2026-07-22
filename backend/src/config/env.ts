import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * 解析 CORS 允许来源白名单。
 * - 生产环境（NODE_ENV=production）：从 CORS_ALLOWED_ORIGINS 读取（逗号分隔），未配置则返回 []（拒绝跨域）
 * - 非生产环境：返回 true（允许全部，方便本地开发）
 */
function parseAllowedOrigins(): string[] | boolean {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (raw && raw.trim()) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  // 未显式配置：生产环境默认收紧为空白名单，开发环境放开
  return (process.env.NODE_ENV || 'development') === 'production' ? [] : true;
}

export const env = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL as string,
  redisUrl: process.env.REDIS_URL as string,
  jwtSecret: process.env.JWT_SECRET as string,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  openspecAgentUrl: process.env.OPENSPEC_AGENT_URL || 'http://localhost:5000',
  // 进程角色：'all'（默认，单进程同时跑 API+Worker）/ 'api'（仅 HTTP+WS，不消费审查队列）/ 'worker'（仅消费队列+定时任务）
  processRole: ((): 'all' | 'api' | 'worker' => {
    const r = (process.env.PROCESS_ROLE || 'all').toLowerCase();
    return r === 'api' || r === 'worker' ? r : 'all';
  })(),
  // CORS 允许来源白名单（string[] 表示白名单，true 表示放开，[] 表示全部拒绝）
  corsAllowedOrigins: parseAllowedOrigins(),
  // MaxKB 凭证（从环境变量读取，不在代码中硬编码默认密码）
  maxkbBaseUrl: process.env.MAXKB_BASE_URL || 'http://localhost:8080',
  maxkbUsername: process.env.MAXKB_USERNAME || 'admin',
  maxkbPassword: process.env.MAXKB_PASSWORD || '',
};
