import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/db';
import { TokenService } from '../services/auth/token.service';
import { MaxKBEmbedService } from '../services/knowledge/maxkb-embed.service';
import { AuthRequest } from '../middlewares/auth.middleware';
import { success, error } from '../utils/response';
import { validatePasswordComplexity } from '../utils/password-validator';

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      error(res, '请提供用户名和密码', 400);
      return;
    }

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      error(res, '用户名或密码错误', 401);
      return;
    }

    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      error(res, '用户名或密码错误', 401);
      return;
    }

    // 密码弱口令检测：已存在但密码不满足复杂度要求时自动标记强制改密
    let mustChangePassword = user.mustChangePassword;
    if (!mustChangePassword) {
      const { validatePasswordComplexity } = await import('../utils/password-validator');
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
      mustChangePassword,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        departmentId: user.departmentId,
        mustChangePassword,
      },
    }, '登录成功');
  } catch (err) {
    console.error('Login Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = (req as any).token;
    if (token) {
      // 简单起见，设定黑名单的过期时间与 Token 最大生命周期一致 (例如 1 天 = 86400 秒)
      // 在生产环境中可以解析 token 中的 exp 来计算剩余时间
      const expiresIn = 86400;
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
