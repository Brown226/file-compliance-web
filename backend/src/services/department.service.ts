import prisma from '../config/db';

export class DepartmentService {
  /**
   * 获取部门树结构
   */
  async getDepartmentsTree() {
    // 获取所有部门
    const departments = await prisma.department.findMany({
      orderBy: { createdAt: 'asc' },
    });

    // 构建树形结构
    const departmentMap = new Map<string, any>();
    const roots: any[] = [];

    // 初始化map，添加children数组
    departments.forEach((dept) => {
      departmentMap.set(dept.id, { ...dept, children: [] });
    });

    // 填充树
    departments.forEach((dept) => {
      const node = departmentMap.get(dept.id);
      if (dept.parentId) {
        const parent = departmentMap.get(dept.parentId);
        if (parent) {
          parent.children.push(node);
        } else {
          // 如果父节点不存在（可能数据异常），作为根节点
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    });

    return roots;
  }

  /**
   * 创建部门
   */
  async createDepartment(data: { name: string; parentId?: string }) {
    if (data.parentId) {
      const parent = await prisma.department.findUnique({
        where: { id: data.parentId },
      });
      if (!parent) {
        throw new Error('Parent department not found');
      }
    }

    return prisma.department.create({
      data,
    });
  }

  /**
   * 更新部门
   */
  async updateDepartment(id: string, data: { name?: string; parentId?: string }) {
    if (data.parentId) {
      if (data.parentId === id) {
        throw new Error('A department cannot be its own parent');
      }
      const parent = await prisma.department.findUnique({
        where: { id: data.parentId },
      });
      if (!parent) {
        throw new Error('Parent department not found');
      }
      
      // 可以进一步检查避免循环引用（即新的parentId不能是当前部门的子节点）
      // 这里为简便省略深度校验
    }

    return prisma.department.update({
      where: { id },
      data,
    });
  }

  /**
   * 查找或创建多级部门路径
   * 支持一级、二级、三级部门自动创建
   * 用于批量导入场景
   */
  async findOrCreateDepartmentPath(path: { level1?: string; level2?: string; level3?: string }) {
    const levels: string[] = [];
    if (path.level1?.trim()) levels.push(path.level1.trim());
    if (path.level2?.trim()) levels.push(path.level2.trim());
    if (path.level3?.trim()) levels.push(path.level3.trim());

    if (levels.length === 0) {
      return { departmentId: null, created: [] };
    }

    let parentId: string | null = null;
    const created: string[] = [];

    for (const levelName of levels) {
      // 查找当前层级中是否有匹配的部门（根据名称 + 父级ID）
      const existing = await prisma.department.findFirst({
        where: { name: levelName, parentId: parentId }
      });

      if (existing) {
        parentId = existing.id;
      } else {
        // 创建新部门
        const newDept = await prisma.department.create({
          data: { name: levelName, parentId }
        });
        created.push(levelName);
        parentId = newDept.id;
      }
    }

    return { departmentId: parentId, created };
  }

  /**
   * 删除部门
   */
  async deleteDepartment(id: string) {
    // 检查是否有子部门
    const childrenCount = await prisma.department.count({
      where: { parentId: id },
    });

    if (childrenCount > 0) {
      throw new Error('Cannot delete department with child departments');
    }

    // 检查是否有员工关联
    const usersCount = await prisma.user.count({
      where: { departmentId: id },
    });

    if (usersCount > 0) {
      throw new Error('Cannot delete department with assigned employees');
    }

    return prisma.department.delete({
      where: { id },
    });
  }
}

export const departmentService = new DepartmentService();
