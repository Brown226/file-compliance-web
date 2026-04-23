import prisma from '../config/db';

export class StandardFolderService {
  /** 获取所有文件夹（扁平列表） */
  static async getAllFolders(): Promise<any[]> {
    return prisma.standardFolder.findMany({
      orderBy: [{ name: 'asc' }],
      include: {
        _count: { select: { standards: true } },
      },
    });
  }

  /** 获取文件夹树形结构 */
  static async getFolderTree(): Promise<any[]> {
    const folders = await prisma.standardFolder.findMany({
      orderBy: [{ name: 'asc' }],
      include: {
        _count: { select: { standards: true } },
      },
    });

    // 构建树形结构
    const map = new Map<string, any>();
    const roots: any[] = [];

    folders.forEach((f) => {
      map.set(f.id, { ...f, children: [] });
    });

    map.forEach((node) => {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  }

  /** 创建文件夹 */
  static async createFolder(data: { name: string; parentId?: string }): Promise<any> {
    // 校验父文件夹存在
    if (data.parentId) {
      const parent = await prisma.standardFolder.findUnique({ where: { id: data.parentId } });
      if (!parent) throw new Error('父文件夹不存在');
    }

    return prisma.standardFolder.create({
      data: {
        name: data.name,
        parentId: data.parentId || null,
      },
      include: {
        _count: { select: { standards: true } },
      },
    });
  }

  /** 更新文件夹 */
  static async updateFolder(id: string, data: { name?: string; parentId?: string | null }): Promise<any> {
    const existing = await prisma.standardFolder.findUnique({ where: { id } });
    if (!existing) throw new Error('文件夹不存在');

    // 防止循环引用：不能将自己设为子文件夹的后代
    if (data.parentId !== undefined) {
      if (data.parentId === id) throw new Error('不能将文件夹设为自己的子文件夹');

      if (data.parentId) {
        let current = await prisma.standardFolder.findUnique({ where: { id: data.parentId } });
        while (current) {
          if (current.id === id) throw new Error('不能将文件夹移动到自己的子文件夹下');
          current = current.parentId
            ? await prisma.standardFolder.findUnique({ where: { id: current.parentId } })
            : null;
        }
      }
    }

    return prisma.standardFolder.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.parentId !== undefined && { parentId: data.parentId || null }),
      },
      include: {
        _count: { select: { standards: true } },
      },
    });
  }

  /** 删除文件夹 */
  static async deleteFolder(id: string): Promise<void> {
    const existing = await prisma.standardFolder.findUnique({
      where: { id },
      include: { _count: { select: { standards: true, children: true } } },
    });
    if (!existing) throw new Error('文件夹不存在');

    if (existing._count.children > 0) {
      throw new Error('文件夹下还有子文件夹，无法删除');
    }

    if (existing._count.standards > 0) {
      throw new Error('文件夹下还有标准，无法删除');
    }

    await prisma.standardFolder.delete({ where: { id } });
  }

  /** 获取文件夹下所有后代文件夹 ID（含自身） */
  static async getDescendantFolderIds(folderId: string): Promise<string[]> {
    const ids = [folderId];
    const children = await prisma.standardFolder.findMany({
      where: { parentId: folderId },
      select: { id: true },
    });

    for (const child of children) {
      const childIds = await this.getDescendantFolderIds(child.id);
      ids.push(...childIds);
    }

    return ids;
  }
}
