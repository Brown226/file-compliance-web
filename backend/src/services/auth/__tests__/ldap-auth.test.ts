/**
 * ldap-auth.service 单元测试
 *
 * 全 mock 隔离：不连真实 AD，只验证逻辑分支：
 * - verifyAdCredentials：bind 成功 → true；InvalidCredentialsError → false；连接失败/超时 → 抛错
 * - authenticateWithAd：AD 通过+本地有 → ok；AD 通过+本地无 → user_not_found；密码错 → ad_failed；不可达 → ad_unreachable
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock ldapjs：createClient 返回可注入行为的对象
const mockBind = vi.fn();
const mockUnbind = vi.fn();
const mockOn = vi.fn();
vi.mock('ldapjs', () => ({
  default: {
    createClient: vi.fn(() => ({
      bind: mockBind,
      unbind: mockUnbind,
      on: mockOn,
      once: mockOn,
    })),
  },
}));

// 环境变量控制：每个用例前重置
function setAdEnv(enabled: string): void {
  process.env.AD_ENABLED = enabled;
  process.env.AD_IP = '10.30.2.5';
  process.env.AD_PORT = '389';
  process.env.AD_BASE_DN = 'CN=信息中心,OU=部门邮箱,OU=CNPE,DC=CNPE,DC=CC';
  process.env.AD_BIND_USER_TEMPLATE = '{username}';
  process.env.AD_TIMEOUT_MS = '1000';
}

// bind 回调模拟：err 为 null 表示成功
function simulateBindResult(err: Error | null): void {
  mockBind.mockImplementation((_dn: string, _pwd: string, cb: (e: Error | null) => void) => {
    cb(err);
  });
}

import { verifyAdCredentials, authenticateWithAd, getAdConfig } from '../ldap-auth.service';

describe('getAdConfig', () => {
  beforeEach(() => setAdEnv('false'));

  it('未启用时 enabled=false', () => {
    expect(getAdConfig().enabled).toBe(false);
  });

  it('AD_ENABLED=true 时 enabled=true', () => {
    setAdEnv('true');
    expect(getAdConfig().enabled).toBe(true);
  });

  it('默认读取脚本中的 AD 配置', () => {
    const cfg = getAdConfig();
    expect(cfg.url).toBe('ldap://10.30.2.5:389');
    expect(cfg.baseDn).toBe('CN=信息中心,OU=部门邮箱,OU=CNPE,DC=CNPE,DC=CC');
    expect(cfg.bindUserTemplate).toBe('{username}');
  });
});

describe('verifyAdCredentials', () => {
  beforeEach(() => {
    setAdEnv('true');
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('bind 成功 → true', async () => {
    simulateBindResult(null);
    await expect(verifyAdCredentials('zhangsan', 'pwd123')).resolves.toBe(true);
    // 验证绑定用的 DN = 模板替换结果
    expect(mockBind).toHaveBeenCalledWith('zhangsan', 'pwd123', expect.any(Function));
  });

  it('InvalidCredentialsError（密码错误）→ false', async () => {
    const err = new Error('Invalid Credentials') as any;
    err.code = 'InvalidCredentialsError';
    simulateBindResult(err);
    await expect(verifyAdCredentials('zhangsan', 'wrong')).resolves.toBe(false);
  });

  it('连接失败（client error 事件）→ 抛错', async () => {
    // 不触发 bind 回调，而是触发 error 事件（模拟连接被拒）
    mockBind.mockImplementation(() => { /* bind 永不回调 */ });
    mockOn.mockImplementation((event: string, cb: (e: Error) => void) => {
      if (event === 'error') {
        setImmediate(() => cb(new Error('ECONNREFUSED')));
      }
    });
    await expect(verifyAdCredentials('zhangsan', 'pwd')).rejects.toThrow(/AD 连接失败/);
  });

  it('AD 未启用时抛错', async () => {
    setAdEnv('false');
    await expect(verifyAdCredentials('zhangsan', 'pwd')).rejects.toThrow(/未启用/);
  });
});

describe('authenticateWithAd', () => {
  const findLocal = vi.fn();

  beforeEach(() => {
    setAdEnv('true');
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('AD 通过 + 本地用户存在 → ok:true', async () => {
    simulateBindResult(null);
    findLocal.mockResolvedValue({ id: 'u1', username: 'zhangsan', role: 'USER' });
    const r = await authenticateWithAd('zhangsan', 'pwd', findLocal);
    expect(r.ok).toBe(true);
    expect(r.user?.username).toBe('zhangsan');
  });

  it('AD 通过 + 本地无用户 → user_not_found（拒绝登录）', async () => {
    simulateBindResult(null);
    findLocal.mockResolvedValue(null);
    const r = await authenticateWithAd('zhangsan', 'pwd', findLocal);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('user_not_found');
  });

  it('密码错误 → ad_failed', async () => {
    const err = new Error('Invalid Credentials') as any;
    err.code = 'InvalidCredentialsError';
    simulateBindResult(err);
    const r = await authenticateWithAd('zhangsan', 'bad', findLocal);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ad_failed');
    // 密码错误不应查询本地用户
    expect(findLocal).not.toHaveBeenCalled();
  });

  it('AD 不可达 → ad_unreachable（交由调用方走本地 fallback）', async () => {
    mockBind.mockImplementation(() => { /* bind 永不回调 */ });
    mockOn.mockImplementation((event: string, cb: (e: Error) => void) => {
      if (event === 'error') {
        setImmediate(() => cb(new Error('ECONNREFUSED')));
      }
    });
    const r = await authenticateWithAd('zhangsan', 'pwd', findLocal);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ad_unreachable');
    expect(r.error).toBeDefined();
  });
});
