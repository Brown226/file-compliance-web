import bcrypt from 'bcryptjs';
import prisma from '../config/db';
import { Prisma } from '@prisma/client';
import { AppError } from '../middlewares/error.middleware';
import { validatePasswordComplexity } from '../utils/password-validator';

/**
 * 递归获取所有下属部门ID
 */
async function getSubDepartmentIds(parentId: string): Promise<string[]> {
  const children = await prisma.department.findMany({
    where: { parentId },
    select: { id: true },
  });

  const ids: string[] = [];
  for (const child of children) {
    ids.push(child.id);
    const subIds = await getSubDepartmentIds(child.id);
    ids.push(...subIds);
  }
  return ids;
}

export class EmployeeService {
  /**
   * 分页查询员工列表
   * @param includeChildren 是否包含子部门员工
   */
  async getEmployees(
    page: number = 1,
    limit: number = 10,
    departmentId?: string,
    search?: string,
    role?: string,
    includeChildren: boolean = true
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};
    if (departmentId) {
      if (includeChildren) {
        // 获取该部门及所有子部门的ID
        const allDeptIds = [departmentId, ...await getSubDepartmentIds(departmentId)];
        where.departmentId = { in: allDeptIds };
      } else {
        where.departmentId = departmentId;
      }
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (role && role !== 'ALL') {
      where.role = role as any;
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          department: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);

    // 移除密码哈希
    const employees = users.map((user) => {
      const { passwordHash, ...rest } = user;
      return rest;
    });

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: employees,
    };
  }

  /**
   * 获取单个员工详情
   */
  async getEmployeeById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        department: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!user) {
      throw new Error('Employee not found');
    }

    const { passwordHash, ...rest } = user;
    return rest;
  }

  /**
   * 创建员工
   */
  async createEmployee(data: any) {
    const { username, password, name, role, departmentId } = data;

    // 检查用户名是否存在
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });
    if (existingUser) {
      throw new Error('Username already exists');
    }

    // 密码复杂度验证
    const finalPassword = password || 'User@12345';
    const passwordCheck = validatePasswordComplexity(finalPassword);
    if (!passwordCheck.valid) {
      throw new AppError(400, `密码不符合要求：${passwordCheck.message}`);
    }

    // 哈希密码
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(finalPassword, salt);

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        name,
        role: role || 'USER',
        departmentId,
        mustChangePassword: true,
      },
    });

    const { passwordHash: _, ...rest } = user;
    return rest;
  }

  /**
   * 批量创建员工（使用事务确保数据一致性）
   */
  async batchCreateEmployees(employees: Array<{
    username: string
    password?: string
    name: string
    role?: string
    departmentId?: string
    email?: string
  }>) {
    const results = {
      successCount: 0,
      failCount: 0,
      errors: [] as string[],
    };

    // 预检查：验证所有用户名是否存在
    const existingUsers = await prisma.user.findMany({
      where: {
        username: { in: employees.map(e => e.username) },
      },
      select: { username: true },
    });
    const existingUsernames = new Set(existingUsers.map(u => u.username));

    // 第一步：预过滤有效员工，并行计算密码哈希
    const validEmployees: Array<{
      username: string;
      name: string;
      passwordHash: string;
      role: string;
      departmentId?: string;
      email?: string;
      rowNum: number;
    }> = [];

    const hashTasks: Promise<void>[] = [];

    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      const rowNum = i + 2;

      try {
        // 检查用户名是否存在
        if (existingUsernames.has(emp.username)) {
          results.failCount++;
          results.errors.push(`第${rowNum}行: 用户名 "${emp.username}" 已存在`);
          continue;
        }

        // 验证必填字段
        if (!emp.username || !emp.name) {
          results.failCount++;
          results.errors.push(`第${rowNum}行: 缺少必填字段（用户名或姓名）`);
          continue;
        }

        // 验证角色合法性
        const validRoles = ['ADMIN', 'MANAGER', 'USER'];
        const role = (emp.role || 'USER').toUpperCase();
        if (!validRoles.includes(role)) {
          results.failCount++;
          results.errors.push(`第${rowNum}行: 无效的角色 "${emp.role}"，应为 ADMIN/MANAGER/USER`);
          continue;
        }

        // 加入哈希任务（并行计算）
        const task = (async () => {
          const finalPassword = emp.password || 'User@12345';
          const passwordCheck = validatePasswordComplexity(finalPassword);
          if (!passwordCheck.valid) {
            results.failCount++;
            results.errors.push(`第${rowNum}行: 密码不符合要求 - ${passwordCheck.message}`);
            return;
          }
          const salt = await bcrypt.genSalt(10);
          const passwordHash = await bcrypt.hash(finalPassword, salt);
          validEmployees.push({
            username: emp.username,
            name: emp.name,
            passwordHash,
            role: role as string,
            departmentId: emp.departmentId,
            email: emp.email,
            rowNum,
          });
        })();
        hashTasks.push(task);
      } catch (err: any) {
        results.failCount++;
        results.errors.push(`第${rowNum}行: 验证失败 - ${err.message}`);
      }
    }

    // 并行计算所有密码哈希
    await Promise.all(hashTasks);

    // 第二步：顺序创建用户（已预计算哈希，大幅减少 DB 连接时间）
    for (const emp of validEmployees) {
      try {
        // 检查用户名是否在创建过程中已被其他请求占用
        if (existingUsernames.has(emp.username)) {
          results.failCount++;
          results.errors.push(`第${emp.rowNum}行: 用户名 "${emp.username}" 已存在`);
          continue;
        }

        await prisma.user.create({
          data: {
            username: emp.username,
            passwordHash: emp.passwordHash,
            name: emp.name,
            role: emp.role as any,
            departmentId: emp.departmentId,
            email: emp.email,
            mustChangePassword: true,
          },
        });

        results.successCount++;
        existingUsernames.add(emp.username);
      } catch (err: any) {
        results.failCount++;
        results.errors.push(`第${emp.rowNum}行: 创建 "${emp.username}" 失败 - ${err.message}`);
        console.error(`批量创建员工失败 [${emp.username}]:`, err);
      }
    }

    return results;
  }

  /**
   * 批量启用/禁用状态
   */
  async batchUpdateStatus(ids: string[], enabled: boolean) {
    await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { enabled } as any,
    });

    return { count: ids.length };
  }

  /**
   * 批量删除员工
   */
  async batchDeleteEmployees(ids: string[]) {
    await prisma.user.deleteMany({
      where: { id: { in: ids } },
    });

    return { count: ids.length };
  }

  /**
   * 重置密码
   */
  async resetPassword(id: string, newPassword?: string) {
    const password = newPassword || 'User@12345'; // 默认密码

    // 密码复杂度验证
    const passwordCheck = validatePasswordComplexity(password);
    if (!passwordCheck.valid) {
      throw new AppError(400, `密码不符合要求：${passwordCheck.message}`);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    await prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    return { message: '密码重置成功' };
  }

  /**
   * 更新员工信息
   */
  async updateEmployee(id: string, data: any) {
    const { username, password, name, role, departmentId } = data;

    const updateData: any = {};
    if (username) {
      // 检查用户名是否被其他用户使用
      const existingUser = await prisma.user.findFirst({
        where: {
          username,
          id: { not: id },
        },
      });
      if (existingUser) {
        throw new Error('Username already in use');
      }
      updateData.username = username;
    }
    
    if (password) {
      const passwordCheck = validatePasswordComplexity(password);
      if (!passwordCheck.valid) {
        throw new AppError(400, `密码不符合要求：${passwordCheck.message}`);
      }
      const salt = await bcrypt.genSalt(10);
      updateData.passwordHash = await bcrypt.hash(password, salt);
    }
    
    if (name) updateData.name = name;
    if (role) updateData.role = role;
    if (departmentId !== undefined) updateData.departmentId = departmentId; // 可以为null以移除部门关联

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      include: {
        department: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const { passwordHash: _, ...rest } = user;
    return rest;
  }

  /**
   * 删除员工
   * 先清理关联的外键记录，若有重要依赖数据则阻止删除
   */
  async deleteEmployee(id: string) {
    const user = await prisma.$transaction(async (tx) => {
      // 1. 删除公告阅读记录
      await tx.userAnnouncementRead.deleteMany({ where: { userId: id } });

      // 2. 解除审计日志的用户关联（置空）
      await tx.auditLog.updateMany({
        where: { userId: id },
        data: { userId: null },
      });

      // 3. 解除反馈处理人关联（置空）
      await tx.feedback.updateMany({
        where: { resolverId: id },
        data: { resolverId: null },
      });

      // 4. 检查是否有重要依赖数据
      const [taskCount, feedbackCount, announcementCount] = await Promise.all([
        tx.task.count({ where: { creatorId: id } }),
        tx.feedback.count({ where: { userId: id } }),
        tx.systemAnnouncement.count({ where: { createdBy: id } }),
      ]);

      if (taskCount > 0 || feedbackCount > 0 || announcementCount > 0) {
        const reasons: string[] = [];
        if (taskCount > 0) reasons.push(`创建了 ${taskCount} 个审查任务`);
        if (feedbackCount > 0) reasons.push(`提交了 ${feedbackCount} 条反馈`);
        if (announcementCount > 0) reasons.push(`创建了 ${announcementCount} 条公告`);
        throw new AppError(409, `该用户有关联数据无法删除：${reasons.join('，')}，请先转移或处理这些数据后再删除`);
      }

      // 5. 删除用户
      return tx.user.delete({ where: { id } });
    });

    const { passwordHash: _, ...rest } = user;
    return rest;
  }

  /**
   * 批量修正用户登录账号
   * 通过部门ID + 真实姓名定位用户，更新其登录账号
   * @param dryRun 为 true 时仅预览（返回匹配结果但不执行更新）
   */
  async batchUpdateUsernames(
    data: Array<{
      departmentId: string
      name: string
      newUsername: string
    }>,
    dryRun: boolean = false
  ) {
    const results = {
      successCount: 0,
      failCount: 0,
      errors: [] as string[],
      matched: [] as Array<{
        rowNum: number
        name: string
        oldUsername: string
        newUsername: string
        status: 'matched' | 'skipped' | 'conflict'
      }>,
    };

    // 预检查新账号是否已被其他用户使用
    const allNewUsernames = data.map(d => d.newUsername.toLowerCase());
    const usersWithTargetNames = await prisma.user.findMany({
      where: { username: { in: allNewUsernames } },
      select: { id: true, username: true },
    });
    const usernameOwnerMap = new Map(usersWithTargetNames.map(u => [u.username.toLowerCase(), u.id]));

    for (let i = 0; i < data.length; i++) {
      const { departmentId, name, newUsername } = data[i];
      const rowNum = i + 2;

      try {
        // 校验参数
        if (!name || !name.trim()) {
          results.failCount++;
          results.errors.push(`第${rowNum}行: 姓名为空`);
          continue;
        }
        if (!newUsername || !newUsername.trim()) {
          results.failCount++;
          results.errors.push(`第${rowNum}行: 新账号为空`);
          continue;
        }

        const lowerNewUsername = newUsername.trim().toLowerCase();

        // 按部门ID + 姓名查找用户
        const users = await prisma.user.findMany({
          where: {
            name: name.trim(),
            departmentId,
          },
          select: { id: true, username: true },
        });

        if (users.length === 0) {
          results.failCount++;
          results.errors.push(`第${rowNum}行: 未找到姓名为"${name}"的用户`);
          continue;
        }

        if (users.length > 1) {
          results.failCount++;
          results.errors.push(`第${rowNum}行: 找到多个姓名为"${name}"的用户，无法确定唯一匹配`);
          continue;
        }

        const user = users[0];

        // 检查新账号是否被其他用户占用
        const ownerId = usernameOwnerMap.get(lowerNewUsername);
        if (ownerId && ownerId !== user.id) {
          results.failCount++;
          results.errors.push(`第${rowNum}行: 新账号"${lowerNewUsername}"已被其他用户使用`);
          continue;
        }

        // 如果新旧账号相同，标记为跳过
        if (user.username.toLowerCase() === lowerNewUsername) {
          results.matched.push({
            rowNum,
            name: name.trim(),
            oldUsername: user.username,
            newUsername: lowerNewUsername,
            status: 'skipped',
          });
          results.successCount++;
          continue;
        }

        // 记录匹配结果
        results.matched.push({
          rowNum,
          name: name.trim(),
          oldUsername: user.username,
          newUsername: lowerNewUsername,
          status: 'matched',
        });

        // 非预览模式下执行更新
        if (!dryRun) {
          await prisma.user.update({
            where: { id: user.id },
            data: { username: lowerNewUsername },
          });
        }

        // 更新账号占用记录
        usernameOwnerMap.set(lowerNewUsername, user.id);

        results.successCount++;
      } catch (err: any) {
        results.failCount++;
        results.errors.push(`第${rowNum}行: 更新"${newUsername}"失败 - ${err.message}`);
        console.error(`批量修正账号失败 [${newUsername}]:`, err);
      }
    }

    return results;
  }
}

export const employeeService = new EmployeeService();
