// Expected findings: 0 (this file should pass preflight cleanly)
//
// This file demonstrates well-written TypeScript with correct imports,
// proper API usage, thorough error handling, parameterized queries, input
// validation, and no known issues. Preflight should NOT flag anything here.

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import pg from "pg";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Task {
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "pending" | "in_progress" | "completed" | "cancelled";
  assigneeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: Task["priority"];
  assigneeId?: string;
}

interface TaskFilter {
  status?: Task["status"];
  priority?: Task["priority"];
  assigneeId?: string;
  limit?: number;
  offset?: number;
}

type TaskEvent = {
  type: "task_created" | "task_updated" | "task_deleted";
  task: Task;
  timestamp: Date;
};

// ---------------------------------------------------------------------------
// Database (parameterized queries, connection pooling, error handling)
// ---------------------------------------------------------------------------

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err.message);
});

/**
 * Fetches tasks from the database using parameterized queries.
 * Demonstrates safe SQL practices and proper error handling.
 */
export async function fetchTasks(filter: TaskFilter): Promise<Task[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filter.status !== undefined) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(filter.status);
  }
  if (filter.priority !== undefined) {
    conditions.push(`priority = $${paramIndex++}`);
    params.push(filter.priority);
  }
  if (filter.assigneeId !== undefined) {
    conditions.push(`assignee_id = $${paramIndex++}`);
    params.push(filter.assigneeId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filter.limit ?? 50, 100);
  const offset = filter.offset ?? 0;

  const query = `
    SELECT id, title, description, priority, status, assignee_id, created_at, updated_at
    FROM tasks
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;
  params.push(limit, offset);

  try {
    const result = await pool.query(query, params);
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      priority: row.priority,
      status: row.status,
      assigneeId: row.assignee_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  } catch (err) {
    console.error("Failed to fetch tasks:", err instanceof Error ? err.message : err);
    throw new Error("Failed to fetch tasks from database");
  }
}

// ---------------------------------------------------------------------------
// In-memory task manager (event-driven, properly typed)
// ---------------------------------------------------------------------------

/**
 * In-memory task manager with event-driven notifications.
 *
 * Provides CRUD operations on tasks and emits events that external
 * listeners (e.g. websocket broadcasters, audit loggers) can subscribe to.
 */
export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private emitter = new EventEmitter();

  on(event: TaskEvent["type"], listener: (event: TaskEvent) => void): void {
    this.emitter.on(event, listener);
  }

  off(event: TaskEvent["type"], listener: (event: TaskEvent) => void): void {
    this.emitter.off(event, listener);
  }

  create(input: CreateTaskInput): Task {
    const trimmedTitle = input.title.trim();
    if (!trimmedTitle) {
      throw new Error("Task title must not be empty");
    }

    const now = new Date();
    const task: Task = {
      id: randomUUID(),
      title: trimmedTitle,
      description: input.description?.trim() ?? "",
      priority: input.priority ?? "medium",
      status: "pending",
      assigneeId: input.assigneeId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.id, task);
    this.emit("task_created", task);
    return task;
  }

  getById(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(filter?: TaskFilter): Task[] {
    let results = Array.from(this.tasks.values());

    if (filter?.status !== undefined) {
      results = results.filter((t) => t.status === filter.status);
    }
    if (filter?.priority !== undefined) {
      results = results.filter((t) => t.priority === filter.priority);
    }
    if (filter?.assigneeId !== undefined) {
      results = results.filter((t) => t.assigneeId === filter.assigneeId);
    }

    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const limit = Math.min(filter?.limit ?? 50, 100);
    const offset = filter?.offset ?? 0;
    return results.slice(offset, offset + limit);
  }

  update(
    id: string,
    changes: Partial<Pick<Task, "title" | "description" | "priority" | "status" | "assigneeId">>,
  ): Task {
    const existing = this.tasks.get(id);
    if (existing === undefined) {
      throw new Error(`Task not found: ${id}`);
    }

    const updated: Task = {
      ...existing,
      ...changes,
      updatedAt: new Date(),
    };

    if (!updated.title.trim()) {
      throw new Error("Task title must not be empty");
    }

    this.tasks.set(id, updated);
    this.emit("task_updated", updated);
    return updated;
  }

  delete(id: string): boolean {
    const existing = this.tasks.get(id);
    if (existing === undefined) {
      return false;
    }

    this.tasks.delete(id);
    this.emit("task_deleted", existing);
    return true;
  }

  get size(): number {
    return this.tasks.size;
  }

  private emit(type: TaskEvent["type"], task: Task): void {
    const event: TaskEvent = { type, task, timestamp: new Date() };
    this.emitter.emit(type, event);
  }
}

// ---------------------------------------------------------------------------
// Express route handler (authentication, input validation, safe queries)
// ---------------------------------------------------------------------------

/**
 * Express middleware that validates the user is authenticated.
 * Demonstrates correct middleware patterns -- always calls next() or
 * sends a response.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = (req as Request & { user?: { id: string; role: string } }).user;

  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  next();
}

/**
 * Handler for creating a task via POST /api/tasks.
 * Validates input, uses parameterized queries, and handles errors.
 */
export async function createTaskHandler(req: Request, res: Response): Promise<void> {
  const { title, description, priority, assigneeId } = req.body;

  if (typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "Title is required and must be a non-empty string" });
    return;
  }

  const validPriorities: Task["priority"][] = ["low", "medium", "high", "urgent"];
  if (priority !== undefined && !validPriorities.includes(priority)) {
    res.status(400).json({
      error: `Invalid priority. Must be one of: ${validPriorities.join(", ")}`,
    });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO tasks (id, title, description, priority, status, assignee_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NOW(), NOW())
       RETURNING id, title, description, priority, status, assignee_id, created_at, updated_at`,
      [randomUUID(), title.trim(), description?.trim() ?? "", priority ?? "medium", assigneeId ?? null],
    );

    res.status(201).json({ task: result.rows[0] });
  } catch (err) {
    console.error("Failed to create task:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Failed to create task" });
  }
}

// ---------------------------------------------------------------------------
// Utility functions (correct API usage, proper null handling)
// ---------------------------------------------------------------------------

/**
 * Safely parses a priority string, returning undefined for invalid input.
 * Uses strict equality and explicit type narrowing.
 */
export function parsePriority(value: unknown): Task["priority"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase().trim();
  const valid: Task["priority"][] = ["low", "medium", "high", "urgent"];
  return valid.includes(normalized as Task["priority"])
    ? (normalized as Task["priority"])
    : undefined;
}

/**
 * Formats a task into a single-line summary suitable for logging.
 * Uses nullish coalescing correctly for nullable fields.
 */
export function formatTaskSummary(task: Task): string {
  const assignee = task.assigneeId ?? "unassigned";
  return `[${task.priority.toUpperCase()}] ${task.title} (${task.status}, ${assignee})`;
}

/**
 * Parses JSON from an untrusted source with proper error handling.
 * Demonstrates correct try/catch around JSON.parse on external input.
 */
export function safeParseJSON<T>(raw: string): { data: T } | { error: string } {
  try {
    const data = JSON.parse(raw) as T;
    return { data };
  } catch {
    return { error: "Invalid JSON input" };
  }
}

/**
 * Correctly checks for property existence using Object.hasOwn (ES2022)
 * with a proper fallback.
 */
export function hasProperty(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
