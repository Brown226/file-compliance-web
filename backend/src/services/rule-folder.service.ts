import prisma from '../config/db';

export interface RuleFolderTreeNode {
  id: string;
  label: string;
  count: number;
  sortOrder: number;
  children: RuleFolderTreeNode[];
  parentId?: string | null;
}

export class RuleFolderService {
  static async getTree(): Promise<RuleFolderTreeNode[]> {
    const folders = await prisma.ruleFolder.findMany({
      include: {
        _count: { select: { libraries: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    const map = new Map<string, RuleFolderTreeNode>();
    const roots: RuleFolderTreeNode[] = [];

    for (const f of folders) {
      const node: RuleFolderTreeNode = {
        id: f.id,
        label: f.name,
        count: f._count.libraries,
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
    const maxOrder = await prisma.ruleFolder.aggregate({
      _max: { sortOrder: true },
      where: { parentId: data.parentId ?? null },
    });
    const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    return prisma.ruleFolder.create({
      data: {
        name: data.name,
        parentId: data.parentId ?? null,
        sortOrder,
      },
    });
  }

  static async update(id: string, data: { name?: string }) {
    return prisma.ruleFolder.update({
      where: { id },
      data: { name: data.name },
    });
  }

  static async delete(id: string) {
    // Move child libraries to parent (or detach)
    const folder = await prisma.ruleFolder.findUnique({
      where: { id },
      include: { children: true },
    });
    if (!folder) throw new Error('目录不存在');

    await prisma.$transaction(async (tx) => {
      // Detach libraries from this folder
      await tx.ruleLibrary.updateMany({
        where: { folderId: id },
        data: { folderId: folder.parentId ?? null },
      });

      // Move child folders to parent
      for (const child of folder.children) {
        await tx.ruleFolder.update({
          where: { id: child.id },
          data: { parentId: folder.parentId ?? null },
        });
      }

      // Delete the folder
      await tx.ruleFolder.delete({ where: { id } });
    });
  }

  static async moveFolders(folderIds: string[], targetId: string) {
    if (folderIds.includes(targetId)) throw new Error('不能移动到自身');

    await prisma.ruleFolder.updateMany({
      where: { id: { in: folderIds } },
      data: { parentId: targetId },
    });
  }

  static async mergeFolders(folderIds: string[], newName: string) {
    if (folderIds.length < 2) throw new Error('至少选择 2 个目录进行合并');

    await prisma.$transaction(async (tx) => {
      const newFolder = await tx.ruleFolder.create({
        data: { name: newName },
      });

      for (const folderId of folderIds) {
        const folder = await tx.ruleFolder.findUnique({
          where: { id: folderId },
          include: { children: true },
        });
        if (!folder) continue;

        // Move libraries to new folder
        await tx.ruleLibrary.updateMany({
          where: { folderId },
          data: { folderId: newFolder.id },
        });

        // Move children to new folder
        await tx.ruleFolder.updateMany({
          where: { parentId: folderId },
          data: { parentId: newFolder.id },
        });

        // Delete old folder
        await tx.ruleFolder.delete({ where: { id: folderId } });
      }
    });
  }

  static async reorder(id: string, data: { newIndex: number; newParentId?: string | null }) {
    const folder = await prisma.ruleFolder.findUnique({ where: { id } });
    if (!folder) throw new Error('目录不存在');

    const targetParentId = data.newParentId !== undefined ? data.newParentId : folder.parentId;

    await prisma.$transaction(async (tx) => {
      // Update parent if changed
      if (targetParentId !== folder.parentId) {
        await tx.ruleFolder.update({
          where: { id },
          data: { parentId: targetParentId ?? null },
        });
      }

      // Get siblings in new position
      const siblings = await tx.ruleFolder.findMany({
        where: { parentId: targetParentId ?? null, id: { not: id } },
        orderBy: { sortOrder: 'asc' },
      });

      // Reorder: insert at newIndex
      const reordered: string[] = siblings.map((s) => s.id);
      reordered.splice(data.newIndex, 0, id);

      for (let i = 0; i < reordered.length; i++) {
        await tx.ruleFolder.update({
          where: { id: reordered[i] },
          data: { sortOrder: i },
        });
      }
    });
  }
}
