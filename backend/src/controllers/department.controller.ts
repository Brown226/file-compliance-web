import { Request, Response, NextFunction } from 'express';
import { departmentService } from '../services/department.service';
import { success, error } from '../utils/response';

export class DepartmentController {
  /**
   * 获取部门树
   */
  async getDepartmentsTree(req: Request, res: Response, next: NextFunction) {
    try {
      const tree = await departmentService.getDepartmentsTree();
      success(res, tree);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 创建部门
   */
  async createDepartment(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, parentId } = req.body;
      if (!name) {
        error(res, 'Department name is required', 400);
        return;
      }

      const department = await departmentService.createDepartment({ name, parentId });
      success(res, department, '创建成功');
    } catch (err) {
      next(err);
    }
  }

  /**
   * 更新部门
   */
  async updateDepartment(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { name, parentId } = req.body;

      const department = await departmentService.updateDepartment(id, { name, parentId });
      success(res, department, '更新成功');
    } catch (err) {
      next(err);
    }
  }

  /**
   * 查找或创建多级部门路径（批量导入用）
   */
  async findOrCreateDepartmentPath(req: Request, res: Response, next: NextFunction) {
    try {
      const { level1, level2, level3 } = req.body;
      const result = await departmentService.findOrCreateDepartmentPath({ level1, level2, level3 });
      success(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 删除部门
   */
  async deleteDepartment(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await departmentService.deleteDepartment(id);
      success(res, null, 'Department deleted successfully');
    } catch (err) {
      next(err);
    }
  }
}

export const departmentController = new DepartmentController();
