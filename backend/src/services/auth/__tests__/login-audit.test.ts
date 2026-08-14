/**
 * login-audit.service 单元测试
 *
 * 验证登录审计 + 失败锁定逻辑（mock prisma，不连 DB）：
 * - record：fire-and-forget 写库（失败不抛）
 * - checkLocked：未锁/锁定/检查失败放行
 * - recordFailure：计数递增、达阈值锁定、失败不抛
 * - clearFailures：清零
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock prisma：loginAudit.create 成功/失败可控，loginFailLock 可注入行为
const loginAuditCreate = vi.fn();
const failLockFindUnique = vi.fn();
const failLockUpsert = vi.fn();
const failLockUpdate = vi.fn();
const failLockDeleteMany = vi.fn();

vi.mock('../../../config/db', () => ({
  default: {
    loginAudit: { create: (...a: any[]) => loginAuditCreate(...a) },
    loginFailLock: {
      findUnique: (...a: any[]) => failLockFindUnique(...a),
      upsert: (...a: any[]) => failLockUpsert(...a),
      update: (...a: any[]) => failLockUpdate(...a),
      deleteMany: (...a: any[]) => failLockDeleteMany(...a),
    },
  },
}));

import { LoginAuditService } from '../login-audit.service';

describe('LoginAuditService.record', () => {
  beforeEach(() => vi.clearAllMocks());

  it('记录成功登录（fire-and-forget，不 await 也写入）', () => {
    loginAuditCreate.mockResolvedValue({ id: '1' });
    LoginAuditService.record({ username: 'zhangsan', success: true, channel: 'ad' });
    expect(loginAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ username: 'zhangsan', success: true, channel: 'ad' }),
    });
  });

  it('写库失败不抛错（审计失败不阻塞登录）', async () => {
    loginAuditCreate.mockRejectedValue(new Error('DB down'));
    // 不抛错即通过
    LoginAuditService.record({ username: 'zhangsan', success: false, channel: 'local', reason: 'bad_credentials' });
    await new Promise((r) => setTimeout(r, 10)); // 等 catch 执行
    expect(loginAuditCreate).toHaveBeenCalled();
  });
});

describe('LoginAuditService.checkLocked', () => {
  beforeEach(() => vi.clearAllMocks());

  it('无锁记录 → 放行', async () => {
    failLockFindUnique.mockResolvedValue(null);
    const r = await LoginAuditService.checkLocked('zhangsan', '1.2.3.4');
    expect(r.locked).toBe(false);
  });

  it('username 锁定未过期 → 拦截', async () => {
    const future = new Date(Date.now() + 60_000);
    failLockFindUnique.mockImplementation(({ where }: any) => {
      if (where.username) return Promise.resolve({ id: 'l1', username: 'zhangsan', lockUntil: future });
      return Promise.resolve(null);
    });
    const r = await LoginAuditService.checkLocked('zhangsan', '1.2.3.4');
    expect(r.locked).toBe(true);
    expect(r.lockUntil).toBe(future);
  });

  it('IP 锁定 → 拦截', async () => {
    const future = new Date(Date.now() + 60_000);
    failLockFindUnique.mockImplementation(({ where }: any) => {
      if (where.ipAddress) return Promise.resolve({ id: 'l2', ipAddress: '1.2.3.4', lockUntil: future });
      return Promise.resolve(null);
    });
    const r = await LoginAuditService.checkLocked('zhangsan', '1.2.3.4');
    expect(r.locked).toBe(true);
  });

  it('锁定已过期 → 放行', async () => {
    const past = new Date(Date.now() - 60_000);
    failLockFindUnique.mockResolvedValue({ id: 'l3', lockUntil: past });
    const r = await LoginAuditService.checkLocked('zhangsan', '1.2.3.4');
    expect(r.locked).toBe(false);
  });

  it('检查失败 → 放行（防御性降级）', async () => {
    failLockFindUnique.mockRejectedValue(new Error('DB down'));
    const r = await LoginAuditService.checkLocked('zhangsan', '1.2.3.4');
    expect(r.locked).toBe(false);
  });
});

describe('LoginAuditService.recordFailure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('计数递增（username + IP 两个维度）', async () => {
    failLockUpsert.mockResolvedValue({ id: 'f1', failCount: 2 });
    failLockFindUnique.mockResolvedValue({ id: 'f1', failCount: 2, lockUntil: null });
    await LoginAuditService.recordFailure('zhangsan', '1.2.3.4');
    expect(failLockUpsert).toHaveBeenCalledTimes(2); // username + IP
  });

  it('达阈值（5 次）→ 锁定', async () => {
    failLockUpsert.mockResolvedValue({ id: 'f1', failCount: 5 });
    failLockFindUnique.mockResolvedValue({ id: 'f1', username: 'zhangsan', failCount: 5, lockUntil: null });
    failLockUpdate.mockResolvedValue({});
    await LoginAuditService.recordFailure('zhangsan', '1.2.3.4');
    expect(failLockUpdate).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: expect.objectContaining({ lockedAt: expect.any(Date), lockUntil: expect.any(Date) }),
    });
  });

  it('未达阈值不锁定', async () => {
    failLockUpsert.mockResolvedValue({ id: 'f1', failCount: 3 });
    failLockFindUnique.mockResolvedValue({ id: 'f1', failCount: 3, lockUntil: null });
    await LoginAuditService.recordFailure('zhangsan', '1.2.3.4');
    expect(failLockUpdate).not.toHaveBeenCalled();
  });

  it('写库失败不抛错', async () => {
    failLockUpsert.mockRejectedValue(new Error('DB down'));
    await expect(LoginAuditService.recordFailure('zhangsan', '1.2.3.4')).resolves.toBeUndefined();
  });
});

describe('LoginAuditService.clearFailures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('登录成功清零 username + IP', async () => {
    failLockDeleteMany.mockResolvedValue({ count: 2 });
    await LoginAuditService.clearFailures('zhangsan', '1.2.3.4');
    expect(failLockDeleteMany).toHaveBeenCalledWith({
      where: { OR: [{ username: 'zhangsan' }, { ipAddress: '1.2.3.4' }] },
    });
  });

  it('清零失败不抛错', async () => {
    failLockDeleteMany.mockRejectedValue(new Error('DB down'));
    await expect(LoginAuditService.clearFailures('zhangsan', '1.2.3.4')).resolves.toBeUndefined();
  });
});
