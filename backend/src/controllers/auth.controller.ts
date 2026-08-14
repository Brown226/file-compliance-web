import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/db';
import { TokenService } from '../services/auth/token.service';
import { AuthRequest } from '../middlewares/auth.middleware';
import { success, error } from '../utils/response';
import { validatePasswordComplexity } from '../utils/password-validator';
import { authenticateWithAd, getAdConfig } from '../services/auth/ldap-auth.service';
import { LoginAuditService } from '../services/auth/login-audit.service';

// 本地密码 fallback 通道的保留账号：AD 故障/未启用时管理员仍可登录，避免系统锁死
const AD_LOCAL_FALLBACK_USERS = new Set(['admin']);

export const login = async (req: Request, res: Response): Promise<void> => {
  const ipAddress = req.ip || req.socket?.remoteAddress;
  const userAgent = req.headers['user-agent'] as string | undefined;

  try {
    const { username, password } = req.body;

    if (!username || !password) {
      LoginAuditService.record({ username: username || 'unknown', success: false, channel: 'local', reason: 'missing_input', ipAddress, userAgent });
      error(res, '请提供用户名和密码', 400);
      return;
    }

    // 登录前锁定检查：防暴力破解（同 username 或 IP 连续失败达阈值）
    const lockCheck = await LoginAuditService.checkLocked(username, ipAddress);
    if (lockCheck.locked) {
      LoginAuditService.record({ username, success: false, channel: 'local', reason: 'locked', ipAddress, userAgent });
      error(res, '登录失败次数过多，账号已锁定 15 分钟，请稍后再试', 423);
      return;
    }

    const adConfig = getAdConfig();
    const isAdminAccount = AD_LOCAL_FALLBACK_USERS.has(username);

    // AD 认证路径（启用且非保留账号）：
    // - 验证通过 + 本地有账号 → 登录
    // - 验证通过 + 本地无账号 → 拒绝（需管理员建档，符合内网管控）
    // - 密码错误 → 拒绝
    // - AD 服务不可达 → fallback 本地密码
    let adResult: { ok: boolean; user?: any; reason?: string; error?: Error } | null = null;
    let adAttempted = false;
    if (adConfig.enabled && !isAdminAccount) {
      adAttempted = true;
      adResult = await authenticateWithAd(
        username,
        password,
        async (uname) => prisma.user.findUnique({ where: { username: uname } }),
      );

      if (adResult.ok && adResult.user) {
        // AD 认证通过：密码由域管控，无需本地弱口令检测
        LoginAuditService.record({ username, success: true, channel: 'ad', ipAddress, userAgent });
        LoginAuditService.clearFailures(username, ipAddress);
        return finishLogin(res, adResult.user, true);
      }
      if (adResult.reason === 'user_not_found') {
        // AD 验证通过但本地未建档 → 拒绝（这是"身份有效但未授权"，不计数失败锁定，避免管理员误锁）
        LoginAuditService.record({ username, success: false, channel: 'ad', reason: 'user_not_found', ipAddress, userAgent });
        error(res, 'AD 账号验证通过，但系统未找到该用户，请联系管理员建档', 401);
        return;
      }
      if (adResult.reason === 'ad_failed') {
        // 密码错误（AD 拒绝）→ 记失败 + 计数
        LoginAuditService.record({ username, success: false, channel: 'ad', reason: 'bad_credentials', ipAddress, userAgent });
        await LoginAuditService.recordFailure(username, ipAddress);
        error(res, '用户名或密码错误', 401);
        return;
      }
      // reason === 'ad_unreachable' → 降级本地密码（记审计后继续）
      LoginAuditService.record({ username, success: false, channel: 'ad', reason: 'ad_unreachable', ipAddress, userAgent });
    }

    // 本地密码验证（现状逻辑：AD 未启用 / 管理员账号 / AD 故障 fallback）
    const localChannel: 'local' | 'ad_fallback' = adAttempted ? 'ad_fallback' : 'local';
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      LoginAuditService.record({ username, success: false, channel: localChannel, reason: 'bad_credentials', ipAddress, userAgent });
      await LoginAuditService.recordFailure(username, ipAddress);
      error(res, '用户名或密码错误', 401);
      return;
    }

    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      LoginAuditService.record({ username, success: false, channel: localChannel, reason: 'bad_credentials', ipAddress, userAgent });
      await LoginAuditService.recordFailure(username, ipAddress);
      error(res, '用户名或密码错误', 401);
      return;
    }

    // 登录成功：记审计 + 清零失败计数
    LoginAuditService.record({ username, success: true, channel: localChannel, ipAddress, userAgent });
    await LoginAuditService.clearFailures(username, ipAddress);

    // 本地通道：对明文密码做弱口令检测，不满足则标记强制改密
    let mustChangePassword = user.mustChangePassword;
    if (!mustChangePassword) {
      const check = validatePasswordComplexity(password);
      if (!check.valid) {
        mustChangePassword = true;
        // 异步更新 DB，不阻塞登录
        prisma.user.update({
          where: { id: user.id },
          data: { mustChangePassword: true },
        }).catch((e: any) => console.warn('[Auth] 自动标记强制改密失败:', e.message));
      }
    }

    // 本地通道：第三参传 false（非 AD，走本地弱口令检测已在上方处理）
    return finishLogin(res, user, false, mustChangePassword);
  } catch (err) {
    console.error('Login Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

/**
 * 登录成功公共出口：生成 token + 返回用户信息
 * @param adAuth 是否 AD 认证路径（true 时跳过本地弱口令检测，密码由域管控）
 * @param mustChangePassword 强制改密标记（本地通道由调用方计算传入；AD 通道恒 false）
 */
async function finishLogin(res: Response, user: any, adAuth: boolean, mustChangePassword = false): Promise<void> {
  const finalMustChange = adAuth ? false : mustChangePassword;

  // 更新最近登录时间（看板在线/活跃度统计用），异步执行不阻塞登录
  prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  }).catch((e: any) => console.warn('[Auth] 更新 lastLoginAt 失败:', e.message));

  // 生成 Token
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    departmentId: user.departmentId,
  };

  const token = TokenService.generateToken(payload);

  success(res, {
    token,
    mustChangePassword: finalMustChange,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      departmentId: user.departmentId,
      mustChangePassword: finalMustChange,
    },
  }, '登录成功');
}

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = (req as any).token;
    if (token) {
      // 黑名单 TTL 与 token 实际剩余有效期对齐（解析 exp），
      // 避免 JWT_EXPIRES_IN 调整后黑名单条目过早过期导致登出的 token 复活
      let expiresIn = 86400;
      try {
        const decoded = TokenService.verifyToken(token);
        if (decoded.exp) {
          expiresIn = Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));
        }
      } catch {
        // token 已失效，黑名单条目用默认 TTL（很快过期，无害）
      }
      await TokenService.blacklistToken(token, expiresIn);
    }
    // 注意：不清除 MaxKB 嵌入会话（UserChatSession），
    // 保留 chatUserToken 以便用户下次登录时复用，保证对话历史持久化。
    success(res, null, '登出成功');
  } catch (err) {
    console.error('Logout Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      error(res, '未认证用户', 401);
      return;
    }

    if (!oldPassword || !newPassword) {
      error(res, '请提供原密码和新密码', 400);
      return;
    }

    // 密码复杂度验证：必须同时包含大小写字母、数字、特殊符号
    const passwordCheck = validatePasswordComplexity(newPassword);
    if (!passwordCheck.valid) {
      error(res, passwordCheck.message, 400);
      return;
    }

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      error(res, '用户不存在', 404);
      return;
    }

    // 验证原密码
    const isPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isPasswordValid) {
      error(res, '原密码错误', 400);
      return;
    }

    // 更新密码（同时清除强制改密标记）
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash, mustChangePassword: false },
    });

    success(res, null, '密码修改成功');
  } catch (err) {
    console.error('Change Password Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const changeUsername = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { newUsername, password } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      error(res, '未认证用户', 401);
      return;
    }

    if (!newUsername || !password) {
      error(res, '请提供新账号和当前密码', 400);
      return;
    }

    if (newUsername.length < 2) {
      error(res, '账号长度不能小于2位', 400);
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
      error(res, '账号只能包含字母、数字和下划线', 400);
      return;
    }

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      error(res, '用户不存在', 404);
      return;
    }

    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      error(res, '密码错误', 400);
      return;
    }

    // 检查新账号是否已被占用
    const existingUser = await prisma.user.findUnique({
      where: { username: newUsername },
    });

    if (existingUser && existingUser.id !== userId) {
      error(res, '该账号已被占用', 409);
      return;
    }

    // 更新账号
    await prisma.user.update({
      where: { id: userId },
      data: { username: newUsername },
    });

    success(res, null, '登录账号修改成功');
  } catch (err) {
    console.error('Change Username Error:', err);
    error(res, '服务器内部错误', 500);
  }
};
