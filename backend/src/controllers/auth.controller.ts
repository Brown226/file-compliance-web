import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/db';
import { TokenService } from '../services/token.service';
import { AuthRequest } from '../middlewares/auth.middleware';
import { success, error } from '../utils/response';

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

    // 生成 Token
    const payload = {
      id: user.id,
      role: user.role,
      departmentId: user.departmentId,
    };
    
    const token = TokenService.generateToken(payload);

    success(res, {
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        departmentId: user.departmentId,
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

    if (newPassword.length < 6) {
      error(res, '新密码长度不能小于6位', 400);
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

    // 更新密码
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    success(res, null, '密码修改成功');
  } catch (err) {
    console.error('Change Password Error:', err);
    error(res, '服务器内部错误', 500);
  }
};
