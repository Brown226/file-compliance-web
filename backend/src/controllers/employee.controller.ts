import { Request, Response, NextFunction } from 'express';
import { employeeService } from '../services/employee.service';
import { success, error } from '../utils/response';

export class EmployeeController {
  /**
   * 分页查询员工列表
   */
  async getEmployees(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const departmentId = req.query.departmentId as string | undefined;
      const search = req.query.search as string | undefined;
      const role = req.query.role as string | undefined;

      const includeChildren = req.query.includeChildren !== 'false';
      const result = await employeeService.getEmployees(page, limit, departmentId, search, role, includeChildren);

      success(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 获取单个员工详情
   */
  async getEmployeeById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as unknown as string;
      const employee = await employeeService.getEmployeeById(id);

      success(res, employee);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 创建员工
   */
  async createEmployee(req: Request, res: Response, next: NextFunction) {
    try {
      const { username, password, name, role, departmentId } = req.body;
      
      if (!username || !name) {
        error(res, 'Username and name are required', 400);
        return;
      }

      const newEmployee = await employeeService.createEmployee({
        username,
        password,
        name,
        role,
        departmentId,
      });

      success(res, newEmployee, '创建成功');
    } catch (err) {
      next(err);
    }
  }

  /**
   * 批量创建员工
   */
  async batchCreateEmployees(req: Request, res: Response, next: NextFunction) {
    try {
      const { employees } = req.body;
      
      if (!Array.isArray(employees) || employees.length === 0) {
        error(res, '请提供员工列表', 400);
        return;
      }

      const result = await employeeService.batchCreateEmployees(employees);

      success(res, result, `成功创建 ${result.successCount} 个账号`);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 批量启用/禁用员工
   */
  async batchUpdateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { ids, enabled } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        error(res, '请提供员工ID列表', 400);
        return;
      }

      const result = await employeeService.batchUpdateStatus(ids, enabled);

      success(res, result, `成功更新 ${result.count} 个账号状态`);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 批量删除员工
   */
  async batchDeleteEmployees(req: Request, res: Response, next: NextFunction) {
    try {
      const { ids } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        error(res, '请提供员工ID列表', 400);
        return;
      }

      const result = await employeeService.batchDeleteEmployees(ids);

      success(res, result, `成功删除 ${result.count} 个账号`);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 重置密码
   */
  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { password } = req.body;
      
      const result = await employeeService.resetPassword(id, password);

      success(res, result, '密码重置成功');
    } catch (err) {
      next(err);
    }
  }

  /**
   * 更新员工
   */
  async updateEmployee(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as unknown as string;
      const { username, password, name, role, departmentId } = req.body;

      const updatedEmployee = await employeeService.updateEmployee(id, {
        username,
        password,
        name,
        role,
        departmentId,
      });

      success(res, updatedEmployee, '更新成功');
    } catch (err) {
      next(err);
    }
  }

  /**
   * 删除员工
   */
  async deleteEmployee(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as unknown as string;
      await employeeService.deleteEmployee(id);

      success(res, null, 'Employee deleted successfully');
    } catch (err) {
      next(err);
    }
  }
}

export const employeeController = new EmployeeController();
