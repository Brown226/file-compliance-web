import { DepartmentService } from '../department.service';

// Mock prisma
jest.mock('../../config/db', () => ({
  __esModule: true,
  default: {
    department: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    user: {
      count: jest.fn(),
    },
  },
}));

// Mock AppError
jest.mock('../../middlewares/error.middleware', () => ({
  AppError: class AppError extends Error {
    constructor(public statusCode: number, message: string) {
      super(message);
      this.name = 'AppError';
    }
  },
}));

import prisma from '../../config/db';

const mockPrisma = prisma as any;

describe('DepartmentService', () => {
  let service: DepartmentService;

  beforeEach(() => {
    service = new DepartmentService();
    jest.clearAllMocks();
  });

  describe('getDepartmentsTree', () => {
    it('should build tree structure from flat list', async () => {
      const departments = [
        { id: '1', name: 'Root', parentId: null, createdAt: new Date() },
        { id: '2', name: 'Child A', parentId: '1', createdAt: new Date() },
        { id: '3', name: 'Child B', parentId: '1', createdAt: new Date() },
        { id: '4', name: 'Grandchild', parentId: '2', createdAt: new Date() },
      ];
      mockPrisma.department.findMany.mockResolvedValue(departments as any);

      const result = await service.getDepartmentsTree();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
      expect(result[0].children).toHaveLength(2);
      expect(result[0].children[0].children).toHaveLength(1);
    });

    it('should handle multiple root departments', async () => {
      const departments = [
        { id: '1', name: 'Root A', parentId: null, createdAt: new Date() },
        { id: '2', name: 'Root B', parentId: null, createdAt: new Date() },
      ];
      mockPrisma.department.findMany.mockResolvedValue(departments as any);

      const result = await service.getDepartmentsTree();
      expect(result).toHaveLength(2);
    });

    it('should handle orphan departments (parent not found)', async () => {
      const departments = [
        { id: '1', name: 'Orphan', parentId: 'nonexistent', createdAt: new Date() },
      ];
      mockPrisma.department.findMany.mockResolvedValue(departments as any);

      const result = await service.getDepartmentsTree();
      expect(result).toHaveLength(1);
    });
  });

  describe('createDepartment', () => {
    it('should create department without parent', async () => {
      const newDept = { id: '1', name: 'New Dept', parentId: null };
      mockPrisma.department.create.mockResolvedValue(newDept as any);

      const result = await service.createDepartment({ name: 'New Dept' });
      expect(result).toEqual(newDept);
      expect(mockPrisma.department.create).toHaveBeenCalledWith({ data: { name: 'New Dept' } });
    });

    it('should create department with valid parent', async () => {
      const parent = { id: 'parent-1', name: 'Parent' };
      const newDept = { id: '1', name: 'Child', parentId: 'parent-1' };

      mockPrisma.department.findUnique.mockResolvedValue(parent as any);
      mockPrisma.department.create.mockResolvedValue(newDept as any);

      const result = await service.createDepartment({ name: 'Child', parentId: 'parent-1' });
      expect(result).toEqual(newDept);
    });

    it('should throw if parent does not exist', async () => {
      mockPrisma.department.findUnique.mockResolvedValue(null);

      await expect(
        service.createDepartment({ name: 'Child', parentId: 'nonexistent' })
      ).rejects.toThrow('父部门不存在');
    });
  });

  describe('updateDepartment', () => {
    it('should update department name', async () => {
      const updated = { id: '1', name: 'Updated' };
      mockPrisma.department.update.mockResolvedValue(updated as any);

      const result = await service.updateDepartment('1', { name: 'Updated' });
      expect(result).toEqual(updated);
    });

    it('should throw if department sets itself as parent', async () => {
      await expect(
        service.updateDepartment('1', { parentId: '1' })
      ).rejects.toThrow('部门不能将自己设为自己的父部门');
    });

    it('should throw if new parent does not exist', async () => {
      mockPrisma.department.findUnique.mockResolvedValue(null);

      await expect(
        service.updateDepartment('1', { parentId: 'nonexistent' })
      ).rejects.toThrow('父部门不存在');
    });
  });

  describe('deleteDepartment', () => {
    it('should delete department with no children or users', async () => {
      mockPrisma.department.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.department.delete.mockResolvedValue({ id: '1' } as any);

      const result = await service.deleteDepartment('1');
      expect(result).toEqual({ id: '1' });
    });

    it('should throw if department has children', async () => {
      mockPrisma.department.count.mockResolvedValue(2);

      await expect(service.deleteDepartment('1')).rejects.toThrow('该部门下存在子部门');
    });

    it('should throw if department has users', async () => {
      mockPrisma.department.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(3);

      await expect(service.deleteDepartment('1')).rejects.toThrow('该部门下有员工关联');
    });
  });

  describe('findOrCreateDepartmentPath', () => {
    it('should return null for empty path', async () => {
      const result = await service.findOrCreateDepartmentPath({});
      expect(result).toEqual({ departmentId: null, created: [] });
    });

    it('should find existing departments', async () => {
      const existing = { id: '1', name: 'Existing' };
      mockPrisma.department.findFirst.mockResolvedValue(existing as any);

      const result = await service.findOrCreateDepartmentPath({ level1: 'Existing' });
      expect(result.departmentId).toBe('1');
      expect(result.created).toEqual([]);
    });

    it('should create new departments', async () => {
      mockPrisma.department.findFirst.mockResolvedValue(null);
      mockPrisma.department.create.mockResolvedValue({ id: 'new-1' } as any);

      const result = await service.findOrCreateDepartmentPath({ level1: 'New' });
      expect(result.departmentId).toBe('new-1');
      expect(result.created).toEqual(['New']);
    });
  });
});
