/**
 * LDAP/AD 域认证服务
 *
 * 对齐内网现有 C# 脚本的 AD 认证逻辑（DirectoryEntry LDAP bind）：
 * - C# 版本：new DirectoryEntry(LDAP://IP:PORT/BASE_DN, UserName, DecryptText(pwd))
 * - 本服务：ldapjs 的 client.bind 完成等价验证
 *
 * 设计：
 * - AD_ENABLED 开关（默认 false）：外网开发环境保持本地密码登录，内网部署置 true 启用 AD
 * - 密码与用户名仅用于 LDAP bind，不在本地落库
 * - bind 带超时（默认 5s），AD 不可达时抛错交由 controller 决定 fallback 本地密码
 */
import ldap from 'ldapjs';

export interface AdConfig {
  enabled: boolean;
  url: string;
  baseDn: string;
  /** 绑定账号格式：{username} 原样（对齐 C# 直传用户名）；可配 CNPE\{username} 或 {username}@domain */
  bindUserTemplate: string;
  /** LDAP bind 超时（毫秒），默认 5000 */
  timeoutMs: number;
}

export function getAdConfig(): AdConfig {
  const bindTemplate = process.env.AD_BIND_USER_TEMPLATE;
  return {
    enabled: process.env.AD_ENABLED === 'true',
    url: `ldap://${process.env.AD_IP || '10.30.2.5'}:${process.env.AD_PORT || '389'}`,
    baseDn: process.env.AD_BASE_DN || 'CN=信息中心,OU=部门邮箱,OU=CNPE,DC=CNPE,DC=CC',
    bindUserTemplate: bindTemplate && bindTemplate.trim() ? bindTemplate : '{username}',
    timeoutMs: Number(process.env.AD_TIMEOUT_MS || 5000),
  };
}

/**
 * AD 域账号验证（LDAP bind）
 *
 * @param username 工号（如 zhangsan）
 * @param password 明文密码
 * @returns true = AD 验证通过；false = 账号/密码错误；抛错 = AD 服务不可达（网络问题）
 *
 * 语义对齐 C#：
 * - bind 成功 → 验证通过（C# 的 Properties.Count > 0）
 * - bind 失败（InvalidCredentialsError）→ 返回 false（C# 的 catch → false）
 * - 连接失败/超时 → 抛错（让 controller 区分"AD 挂了"与"密码错了"，走本地 fallback）
 */
export async function verifyAdCredentials(username: string, password: string): Promise<boolean> {
  const cfg = getAdConfig();
  if (!cfg.enabled) {
    throw new Error('AD 认证未启用（AD_ENABLED !== true）');
  }

  const bindDn = cfg.bindUserTemplate.replace('{username}', username);

  return new Promise<boolean>((resolve, reject) => {
    const client = ldap.createClient({
      url: cfg.url,
      timeout: cfg.timeoutMs,
      connectTimeout: cfg.timeoutMs,
    });

    const timer = setTimeout(() => {
      try {
        client.unbind();
      } catch {
        /* 忽略清理异常 */
      }
      reject(new Error(`AD 连接超时（${cfg.url}）`));
    }, cfg.timeoutMs);

    client.on('error', (err: any) => {
      clearTimeout(timer);
      // 连接阶段错误（ECONNREFUSED / ENOTFOUND 等）= AD 不可达，抛给上层走 fallback
      reject(new Error(`AD 连接失败: ${err?.message || err}`));
    });

    client.bind(bindDn, password, (err: any) => {
      clearTimeout(timer);
      if (!err) {
        // bind 成功 → 验证通过
        resolve(true);
        return;
      }
      const code = (err as any)?.code || '';
      if (code === 'InvalidCredentialsError' || code === 49 || err?.name === 'InvalidCredentialsError') {
        // 账号/密码错误 → 返回 false（与 C# 的 catch → false 一致）
        resolve(false);
      } else {
        // 其他 bind 错误（协议/服务端异常）→ 抛错走 fallback
        reject(new Error(`AD 验证异常: ${err?.message || err}`));
      }
    });

    // 兜底：bind 回调从未触发时确保 promise 不悬挂
    client.once('connect', () => {
      // ldapjs 连接成功事件，仅作占位——bind 回调正常触发即可
    });
  });
}

/**
 * 便捷封装：AD 验证 + 本地用户查找一体
 *
 * 返回值：
 * - { ok: true,  user }  AD 验证通过且本地用户存在
 * - { ok: false, reason: 'ad_failed' }   AD 验证失败（账号/密码错）
 * - { ok: false, reason: 'user_not_found' }  AD 通过但本地未建档（决策点①：拒绝登录）
 * - { ok: false, reason: 'ad_unreachable', error }  AD 服务不可达（由调用方决定本地 fallback）
 */
export async function authenticateWithAd(
  username: string,
  password: string,
  findLocalUser: (username: string) => Promise<any>,
): Promise<{ ok: boolean; user?: any; reason?: 'ad_failed' | 'user_not_found' | 'ad_unreachable'; error?: Error }> {
  let adOk: boolean;
  try {
    adOk = await verifyAdCredentials(username, password);
  } catch (err: any) {
    // AD 不可达（连接失败/超时）→ 交给调用方走本地密码 fallback
    return { ok: false, reason: 'ad_unreachable', error: err };
  }

  if (!adOk) {
    // 密码错误 → 拒绝（与 C# 一致不区分用户是否存在）
    return { ok: false, reason: 'ad_failed' };
  }

  // AD 验证通过 → 查本地用户（username 即工号，与 AD 账号一致）
  const user = await findLocalUser(username);
  if (!user) {
    return { ok: false, reason: 'user_not_found' };
  }
  return { ok: true, user };
}
