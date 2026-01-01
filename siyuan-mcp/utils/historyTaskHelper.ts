/**
 * History task helper for tracking MCP operations
 * Uses file-based storage via kernel API
 */

import { getJSONFile, putJSONFile } from '../syapi';

const TASKS_FILE_PATH = '/data/storage/petal/syplugin-anMCPServer/tasks.json';

export const TASK_STATUS = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: -1,
};

interface Task {
  id: number;
  modifiedIds: string[];
  content: string;
  taskType: string;
  args: any;
  status: number;
  createdAt: string;
  updatedAt: string;
}

class TaskManager {
  private filePath: string;
  private tasks: Task[];
  private nextId: number;
  private initialized: boolean;

  constructor(filePath = TASKS_FILE_PATH) {
    this.filePath = filePath;
    this.tasks = [];
    this.nextId = 1;
    this.initialized = false;
  }

  /**
   * Initialize: load task data from file
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      const data = await getJSONFile(this.filePath);
      if (data && data.tasks) {
        this.tasks = data.tasks;
        if (this.tasks.length > 0) {
          this.nextId = Math.max(...this.tasks.map((t) => t.id)) + 1;
        }
      }
      this.initialized = true;
    } catch {
      // File doesn't exist yet, start with empty tasks
      this.initialized = true;
    }
  }

  /**
   * Persist task data to file
   */
  private async save(): Promise<void> {
    await putJSONFile(this.filePath, { tasks: this.tasks }, false);
  }

  /**
   * Insert a new task
   */
  async insert(
    ids: string | string[],
    content: string,
    taskType: string,
    args: any,
    status = TASK_STATUS.PENDING
  ): Promise<number> {
    await this.init();

    const taskId = this.nextId++;
    const newTask: Task = {
      id: taskId,
      modifiedIds: Array.isArray(ids) ? ids : [ids],
      content: content,
      taskType: taskType,
      args: args,
      status: status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.tasks.push(newTask);
    await this.save();
    return taskId;
  }

  private getTaskById(taskId: number): Task | undefined {
    return this.tasks.find((task) => task.id === taskId);
  }

  /**
   * Mark task as approved
   */
  async solve(taskId: number): Promise<void> {
    await this.init();
    const task = this.getTaskById(taskId);
    if (task) {
      task.status = TASK_STATUS.APPROVED;
      task.updatedAt = new Date().toISOString();
      await this.save();
    }
  }

  /**
   * Mark task as rejected
   */
  async reject(taskId: number): Promise<void> {
    await this.init();
    const task = this.getTaskById(taskId);
    if (task) {
      task.status = TASK_STATUS.REJECTED;
      task.updatedAt = new Date().toISOString();
      await this.save();
    }
  }

  /**
   * Reject all pending tasks
   */
  async rejectAll(): Promise<void> {
    await this.init();
    this.tasks.forEach((task) => {
      if (task.status === TASK_STATUS.PENDING) {
        task.status = TASK_STATUS.REJECTED;
        task.updatedAt = new Date().toISOString();
      }
    });
    await this.save();
  }

  /**
   * List all tasks
   */
  listAll(sortOrder: 'asc' | 'desc' = 'desc'): Task[] {
    const sortedTasks = [...this.tasks].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });
    return sortedTasks;
  }

  /**
   * List pending tasks
   */
  list(sortOrder: 'asc' | 'desc' = 'desc'): Task[] {
    const pendingTasks = this.tasks.filter((task) => task.status === TASK_STATUS.PENDING);
    const sortedPendingTasks = pendingTasks.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });
    return sortedPendingTasks;
  }

  /**
   * Clean old tasks
   */
  async clean(days: number, cleanUnapproved = false): Promise<void> {
    await this.init();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    this.tasks = this.tasks.filter((task) => {
      const isOld = new Date(task.createdAt) < cutoffDate;
      const isUnapproved = task.status === TASK_STATUS.PENDING;

      if (isOld) {
        if (isUnapproved && !cleanUnapproved) {
          return true;
        }
        return false;
      }
      return true;
    });

    await this.save();
  }

  getTask(taskId: number): Task | undefined {
    return this.getTaskById(taskId);
  }
}

export const taskManager = new TaskManager();
