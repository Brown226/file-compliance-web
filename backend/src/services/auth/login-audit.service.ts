/**
 * LoginAuditService — 登录审计 + 失败锁定
 *
 * 对齐 qm-cnpe 的 audit 思想（append-only 结构化事件 + 尽力而为写入，失败不阻塞主流程）
 * 和 rate-limiter（按 principal/IP 维度限制暴力破解）。
 *
 * 职责：
 * 1. record()：记录每次登录尝试（成功/失败/渠道/原因），fire-and-forget 写库
 * 2. checkLocked()：登录前检查 username/IP 是否被锁定
 * 3. recordFailure()：失败计数 +1，达到阈值（默认 5 次）锁定 15 分钟
 * 4. clearFailures()：登录成功后清零
 */
import prisma from '../../config/db';

export type LoginChannel = 'local' | 'ad' | 'ad_fallback';
export type LoginFailureReason =
  | 'bad_credentials'
  | 'user_not_found'
  | 'ad_unreachable'
  | 'locked'
  | 'missing_input';

/** 失败阈值：同一 username 或 IP 连续失败 N 次锁定 */
const MAX_FAILURES = 5;
/** 锁定时长（毫秒）：默认 15 分钟 */
const LOCK_MS = 15 * 60 * 1000;

export class LoginAuditService {
  /**
   * 记录一次登录尝试（尽力而为：写库失败只 console.warn，不阻塞登录主流程）
   */
  static record(data: {
    username: string;
    success: boolean;
    channel: LoginChannel;
    reason?: LoginFailureReason | string;
    ipAddress?: string;
    userAgent?: string;
  }): void {
    prisma.loginAudit
      .create({
        data: {
          username: data.username,
          success: data.success,
          channel: data.channel,
          reason: data.reason ?? null,
          ipAddress: data.ipAddress ?? null,
          userAgent: data.userAgent ? data.userAgent.slice(0, 500) : null,
        },
      })
      .catch((e: any) => {
        // 审计失败不影响登录（与 qm 的"审计失败不阻塞业务"原则一致）
        console.warn('[LoginAudit] 记录登录审计失败:', e?.message || e);
      });
  }

  /**
   * 检查 username 或 IP 是否处于锁定状态
   * @returns { locked, lockUntil } locked=true 表示当前被锁
   */
  static async checkLocked(
    username: string,
    ipAddress?: string,
  ): Promise<{ locked: boolean; lockUntil: Date | null }> {
    try {
      const keys = [
        prisma.loginFailLock.findUnique({ where: { username } }),
        ...(ipAddress
          ? [prisma.loginFailLock.findUnique({ where: { ipAddress } })]
          : []),
      ];
      const [byUser, byIp] = await Promise.all(keys);

      for (const lock of [byUser, byIp]) {
        if (lock && lock.lockUntil && lock.lockUntil > new Date()) {
          return { locked: true, lockUntil: lock.lockUntil };
        }
      }
      return { locked: false, lockUntil: null };
    } catch (e: any) {
      // 锁定检查失败不阻塞登录（防御性降级）
      console.warn('[LoginAudit] 锁定检查失败（放行）:', e?.message || e);
      return { locked: false, lockUntil: null };
    }
  }

  /**
   * 记录一次失败：username 和 IP 各自计数 +1，达到阈值锁定
   */
  static async recordFailure(username: string, ipAddress?: string): Promise<void> {
    try {
      const now = new Date();
      await Promise.all([
        // username 维度
        prisma.loginFailLock.upsert({
          where: { username },
          create: { username, failCount: 1, ipAddress: null },
          update: {
            failCount: { increment: 1 },
            lockedAt: undefined,
            lockUntil: undefined,
          },
        }),
        // IP 维度
        ...(ipAddress
          ? [
              prisma.loginFailLock.upsert({
                where: { ipAddress },
                create: { username: null, ipAddress, failCount: 1 },
                update: {
                  failCount: { increment: 1 },
                  lockedAt: undefined,
                  lockUntil: undefined,
                },
              }),
            ]
          : []),
      ]);

      // 检查是否达到阈值 → 锁定（重新读最新计数）
      const [byUser, byIp] = await Promise.all([
        prisma.loginFailLock.findUnique({ where: { username } }),
        ...(ipAddress
          ? [prisma.loginFailLock.findUnique({ where: { ipAddress } })]
          : []),
      ]);
      for (const lock of [byUser, byIp]) {
        if (lock && lock.failCount >= MAX_FAILURES && !lock.lockUntil) {
          await prisma.loginFailLock.update({
            where: { id: lock.id },
            data: { lockedAt: now, lockUntil: new Date(now.getTime() + LOCK_MS) },
          });
          console.warn(`[LoginAudit] 登录失败达 ${MAX_FAILURES} 次，锁定 15 分钟: ${lock.username || lock.ipAddress}`);
        }
      }
    } catch (e: any) {
      // 失败计数失败不阻塞登录
      console.warn('[LoginAudit] 失败计数异常:', e?.message || e);
    }
  }

  /**
   * 登录成功后清零失败计数（username + IP）
   */
  static async clearFailures(username: string, ipAddress?: string): Promise<void> {
    try {
      await prisma.loginFailLock.deleteMany({
        where: {
          OR: [{ username }, ...(ipAddress ? [{ ipAddress }] : [])],
        },
      });
    } catch (e: any) {
      console.warn('[LoginAudit] 清零失败计数异常:', e?.message || e);
    }
  }
}
