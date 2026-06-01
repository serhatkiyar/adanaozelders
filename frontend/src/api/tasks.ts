import { apiClient } from "@/api/axios";
import type {
  Subtask,
  Task,
  TaskCreate,
  TaskList,
  TaskListCreate,
  TaskStatusFilter,
  TaskUpdate,
} from "@/types";

// ── Listeler ──
export async function fetchTaskLists(): Promise<TaskList[]> {
  const { data } = await apiClient.get<TaskList[]>("/tasks/lists");
  return data;
}

export async function createTaskList(payload: TaskListCreate): Promise<TaskList> {
  const { data } = await apiClient.post<TaskList>("/tasks/lists", payload);
  return data;
}

export async function updateTaskList(
  id: number,
  payload: Partial<TaskListCreate>
): Promise<TaskList> {
  const { data } = await apiClient.patch<TaskList>(`/tasks/lists/${id}`, payload);
  return data;
}

export async function deleteTaskList(id: number): Promise<void> {
  await apiClient.delete(`/tasks/lists/${id}`);
}

// ── Görevler ──
export async function fetchTasks(params: {
  listId?: number | null;
  status?: TaskStatusFilter;
  bookingId?: number | null;
}): Promise<Task[]> {
  const { data } = await apiClient.get<Task[]>("/tasks", {
    params: {
      list_id: params.listId ?? undefined,
      booking_id: params.bookingId ?? undefined,
      status: params.status ?? "active",
    },
  });
  return data;
}

export async function createTask(
  listId: number,
  payload: TaskCreate
): Promise<Task> {
  const { data } = await apiClient.post<Task>(
    `/tasks/lists/${listId}/tasks`,
    payload
  );
  return data;
}

export async function updateTask(id: number, payload: TaskUpdate): Promise<Task> {
  const { data } = await apiClient.patch<Task>(`/tasks/${id}`, payload);
  return data;
}

export async function toggleTask(id: number): Promise<Task> {
  const { data } = await apiClient.post<Task>(`/tasks/${id}/toggle`);
  return data;
}

export async function deleteTask(id: number): Promise<void> {
  await apiClient.delete(`/tasks/${id}`);
}

// ── Alt görevler ──
export async function createSubtask(
  taskId: number,
  title: string
): Promise<Subtask> {
  const { data } = await apiClient.post<Subtask>(`/tasks/${taskId}/subtasks`, {
    title,
  });
  return data;
}

export async function updateSubtask(
  id: number,
  payload: { title?: string; is_done?: boolean }
): Promise<Subtask> {
  const { data } = await apiClient.patch<Subtask>(`/tasks/subtasks/${id}`, payload);
  return data;
}

export async function deleteSubtask(id: number): Promise<void> {
  await apiClient.delete(`/tasks/subtasks/${id}`);
}
