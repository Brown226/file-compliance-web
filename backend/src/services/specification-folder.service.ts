import prisma from '../config/db';

export interface SpecificationFolderTreeNode {
  id: string;
  label: string;
  count: number;
  sortOrder: number;
  children: SpecificationFolderTreeNode[];
  parentId?: string | null;
}

export class SpecificationFolderService {
  static async getTree(): Promise<SpecificationFolderTreeNode[]> {
    const folders = await prisma.specificationFolder.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    const map = new Map<string, SpecificationFolderTreeNode>();
    const roots: SpecificationFolderTreeNode[] = [];

    for (const f of folders) {
      const node: SpecificationFolderTreeNode = {
        id: f.id,
        label: f.name,
        count: 0, // ReviewSpecification 已删除，不再统计
        sortOrder: f.sortOrder,
        parentId: f.parentId,
        children: [],
      };
      map.set(f.id, node);
    }

    for (const f of folders) {
      const node = map.get(f.id)!;
      if (f.parentId && map.has(f.parentId)) {
        map.get(f.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  static async create(data: { name: string; parentId?: string | null }) {
    const maxOrder = await prisma.specificationFolder.aggregate({
      _max: { sortOrder: true },
      where: { parentId: data.parentId ?? null },
    });
    const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    return prisma.specificationFolder.create({
      data: {
        name: data.name,
        parentId: data.parentId ?? null,
        sortOrder,
      },
    });
  }

  static async update(id: string, data: { name?: string }) {
    return prisma.specificationFolder.update({
      where: { id },
      data: { name: data.name },
    });
  }

  static async delete(id: string) {
    const folder = await prisma.specificationFolder.findUnique({
      where: { id },
      include: { children: true },
    });
    if (!folder) throw new Error('目录不存在');

    await prisma.$transaction(async (tx) => {
      for (const child of folder.children) {
        await tx.specificationFolder.update({
          where: { id: child.id },
          data: { parentId: folder.parentId ?? null },
        });
      }

      await tx.specificationFolder.delete({ where: { id } });
    });
  }

  static async moveFolders(folderIds: string[], targetId: string) {
    if (folderIds.includes(targetId)) throw new Error('不能移动到自身');

    await prisma.specificationFolder.updateMany({
      where: { id: { in: folderIds } },
      data: { parentId: targetId },
    });
  }

  static async mergeFolders(folderIds: string[], newName: string) {
    if (folderIds.length < 2) throw new Error('至少选择 2 个目录进行合并');

    await prisma.$transaction(async (tx) => {
      const newFolder = await tx.specificationFolder.create({
        data: { name: newName },
      });

      for (const folderId of folderIds) {
        const folder = await tx.specificationFolder.findUnique({
          where: { id: folderId },
          include: { children: true },
        });
        if (!folder) continue;

        await tx.specificationFolder.updateMany({
          where: { parentId: folderId },
          data: { parentId: newFolder.id },
        });

        await tx.specificationFolder.delete({ where: { id: folderId } });
      }
    });
  }

  static async reorder(id: string, data: { newIndex: number; newParentId?: string | null }) {
    const folder = await prisma.specificationFolder.findUnique({ where: { id } });
    if (!folder) throw new Error('目录不存在');

    const targetParentId = data.newParentId !== undefined ? data.newParentId : folder.parentId;

    await prisma.$transaction(async (tx) => {
      if (targetParentId !== folder.parentId) {
        await tx.specificationFolder.update({
          where: { id },
          data: { parentId: targetParentId ?? null },
        });
      }

      const siblings = await tx.specificationFolder.findMany({
        where: { parentId: targetParentId ?? null, id: { not: id } },
        orderBy: { sortOrder: 'asc' },
      });

      const reordered: string[] = siblings.map((s) => s.id);
      reordered.splice(data.newIndex, 0, id);

      for (let i = 0; i < reordered.length; i++) {
        await tx.specificationFolder.update({
          where: { id: reordered[i] },
          data: { sortOrder: i },
        });
      }
    });
  }
}