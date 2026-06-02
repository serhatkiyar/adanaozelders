import { apiClient } from "@/api/axios";
import type {
  LabelCreate,
  Subtask,
  Task,
  TaskCreate,
  TaskFilter,
  TaskFilterCreate,
  TaskLabel,
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
  payload: Partial<TaskListCreate> & { is_favorite?: boolean }
): Promise<TaskList> {
  const { data } = await apiClient.patch<TaskList>(`/tasks/lists/${id}`, payload);
  return data;
}

export async function deleteTaskList(id: number): Promise<void> {
  await apiClient.delete(`/tasks/lists/${id}`);
}

export async function reorderTaskLists(ids: number[]): Promise<void> {
  await apiClient.post("/tasks/lists/reorder", { ids });
}

// ── Etiketler ──
export async function fetchLabels(): Promise<TaskLabel[]> {
  const { data } = await apiClient.get<TaskLabel[]>("/tasks/labels");
  return data;
}

export async function createLabel(payload: LabelCreate): Promise<TaskLabel> {
  const { data } = await apiClient.post<TaskLabel>("/tasks/labels", payload);
  return data;
}

export async function updateLabel(
  id: number,
  payload: Partial<LabelCreate> & { is_favorite?: boolean }
): Promise<TaskLabel> {
  const { data } = await apiClient.patch<TaskLabel>(`/tasks/labels/${id}`, payload);
  return data;
}

export async function deleteLabel(id: number): Promise<void> {
  await apiClient.delete(`/tasks/labels/${id}`);
}

// ── Kayıtlı filtreler ──
export async function fetchTaskFilters(): Promise<TaskFilter[]> {
  const { data } = await apiClient.get<TaskFilter[]>("/tasks/filters");
  return data;
}

export async function createTaskFilter(
  payload: TaskFilterCreate
): Promise<TaskFilter> {
  const { data } = await apiClient.post<TaskFilter>("/tasks/filters", payload);
  return data;
}

export async function updateTaskFilter(
  id: number,
  payload: Partial<TaskFilterCreate> & { is_favorite?: boolean }
): Promise<TaskFilter> {
  const { data } = await apiClient.patch<TaskFilter>(`/tasks/filters/${id}`, payload);
  return data;
}

export async function deleteTaskFilter(id: number): Promise<void> {
  await apiClient.delete(`/tasks/filters/${id}`);
}

// ── Görevler ──
export async function fetchTasks(params: {
  listId?: number | null;
  status?: TaskStatusFilter;
  bookingId?: number | null;
  labelId?: number | null;
}): Promise<Task[]> {
  const { data } = await apiClient.get<Task[]>("/tasks", {
    params: {
      list_id: params.listId ?? undefined,
      booking_id: params.bookingId ?? undefined,
      label_id: params.labelId ?? undefined,
      status: params.status ?? "active",
    },
  });
  return data;
}

export async function reorderTasks(ids: number[]): Promise<void> {
  await apiClient.post("/tasks/reorder", { ids });
}

// İstemcinin yerel zaman dilimi (IANA, örn 'Europe/Istanbul').
function clientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export async function createTask(
  listId: number,
  payload: TaskCreate
): Promise<Task> {
  const { data } = await apiClient.post<Task>(
    `/tasks/lists/${listId}/tasks`,
    { timezone: clientTimezone(), ...payload }
  );
  return data;
}

export async function updateTask(id: number, payload: TaskUpdate): Promise<Task> {
  const { data } = await apiClient.patch<Task>(`/tasks/${id}`, {
    timezone: clientTimezone(),
    ...payload,
  });
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
