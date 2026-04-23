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
      where.role = role;
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
   * 批量创建员工
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

    for (const emp of employees) {
      try {
        // 检查用户名是否存在
        const existingUser = await prisma.user.findUnique({
          where: { username: emp.username },
        });
        if (existingUser) {
          results.failCount++;
          results.errors.push(`用户名 "${emp.username}" 已存在`);
          continue;
        }

        // 哈希密码
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(emp.password || '123456', salt);

        await prisma.user.create({
          data: {
            username: emp.username,
            passwordHash,
            name: emp.name,
            role: emp.role || 'USER',
            departmentId: emp.departmentId,
            email: emp.email,
          },
        });

        results.successCount++;
      } catch (err: any) {
        results.failCount++;
        results.errors.push(`创建 "${emp.username}" 失败: ${err.message}`);
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
      data: { enabled },
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
