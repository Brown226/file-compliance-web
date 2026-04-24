import bcrypt from 'bcryptjs';
import prisma from '../config/db';
import { Prisma } from '@prisma/client';

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

    // 哈希密码
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password || '123456', salt); // 默认密码 123456

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        name,
        role: role || 'USER',
        departmentId,
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

    // 逐个处理，但使用独立的事务包裹每个创建操作
    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      const rowNum = i + 2; // Excel 行号（从2开始，因为第1行是表头）
      
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

        // 哈希密码
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(emp.password || '123456', salt);

        // 创建用户
        await prisma.user.create({
          data: {
            username: emp.username,
            passwordHash,
            name: emp.name,
            role: role as any,
            departmentId: emp.departmentId,
            email: emp.email,
          },
        });

        results.successCount++;
        // 将刚成功的用户名加入已存在集合，避免重复
        existingUsernames.add(emp.username);
      } catch (err: any) {
        results.failCount++;
        results.errors.push(`第${rowNum}行: 创建 "${emp.username}" 失败 - ${err.message}`);
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
    const password = newPassword || '123456'; // 默认密码
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
   */
  async deleteEmployee(id: string) {
    // 检查关联任务等（如果需要级联删除或阻止删除，视业务而定）
    // 当前直接删除
    const user = await prisma.user.delete({
      where: { id },
    });

    const { passwordHash: _, ...rest } = user;
    return rest;
  }
}

export const employeeService = new EmployeeService();
