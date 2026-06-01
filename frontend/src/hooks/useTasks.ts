import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createLabel,
  createSubtask,
  createTask,
  createTaskList,
  deleteLabel,
  deleteSubtask,
  deleteTask,
  deleteTaskList,
  fetchLabels,
  fetchTaskLists,
  fetchTasks,
  reorderTaskLists,
  reorderTasks,
  toggleTask,
  updateLabel,
  updateSubtask,
  updateTask,
  updateTaskList,
} from "@/api/tasks";
import { useAuthStore } from "@/store/authStore";
import type {
  LabelCreate,
  TaskCreate,
  TaskListCreate,
  TaskStatusFilter,
  TaskUpdate,
} from "@/types";

const TASKS_ROOT = ["tasks"] as const;
const LISTS_KEY = ["tasks", "lists"] as const;
const LABELS_KEY = ["tasks", "labels"] as const;

export interface TasksQuery {
  listId?: number | null;
  status?: TaskStatusFilter;
  labelId?: number | null;
  enabled?: boolean;
}

// Görev veya liste değişince hem listeleri (sayaçlar) hem öğeleri tazele.
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: TASKS_ROOT });
}

export function useTaskLists() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: LISTS_KEY,
    queryFn: fetchTaskLists,
    enabled: !!token,
  });
}

export function useLabels() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: LABELS_KEY,
    queryFn: fetchLabels,
    enabled: !!token,
  });
}

export function useTasks(query: TasksQuery) {
  const token = useAuthStore((s) => s.token);
  const { listId = null, status = "active", labelId = null, enabled = true } = query;
  return useQuery({
    queryKey: ["tasks", "items", listId ?? "all", labelId ?? "none", status],
    queryFn: () => fetchTasks({ listId, status, labelId }),
    enabled: !!token && enabled,
  });
}

// Belirli bir derse bağlı görevler (ders detayı kartı için).
export function useTasksForBooking(bookingId: number) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["tasks", "booking", bookingId],
    queryFn: () => fetchTasks({ bookingId, status: "all" }),
    enabled: !!token && Number.isFinite(bookingId) && bookingId > 0,
  });
}

// ── Liste mutasyonları ──
export function useCreateTaskList() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (payload: TaskListCreate) => createTaskList(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateTaskList() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<TaskListCreate> }) =>
      updateTaskList(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteTaskList() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => deleteTaskList(id),
    onSuccess: invalidate,
  });
}

export function useReorderTaskLists() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (ids: number[]) => reorderTaskLists(ids),
    onSuccess: invalidate,
  });
}

export function useReorderTasks() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (ids: number[]) => reorderTasks(ids),
    onSuccess: invalidate,
  });
}

// ── Etiket mutasyonları ──
export function useCreateLabel() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (payload: LabelCreate) => createLabel(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateLabel() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<LabelCreate> }) =>
      updateLabel(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteLabel() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => deleteLabel(id),
    onSuccess: invalidate,
  });
}

// ── Görev mutasyonları ──
export function useCreateTask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ listId, payload }: { listId: number; payload: TaskCreate }) =>
      createTask(listId, payload),
    onSuccess: invalidate,
  });
}

export function useUpdateTask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: TaskUpdate }) =>
      updateTask(id, payload),
    onSuccess: invalidate,
  });
}

export function useToggleTask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => toggleTask(id),
    onSuccess: invalidate,
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => deleteTask(id),
    onSuccess: invalidate,
  });
}

// ── Alt görev mutasyonları ──
export function useCreateSubtask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ taskId, title }: { taskId: number; title: string }) =>
      createSubtask(taskId, title),
    onSuccess: invalidate,
  });
}

export function useUpdateSubtask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: { title?: string; is_done?: boolean };
    }) => updateSubtask(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteSubtask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => deleteSubtask(id),
    onSuccess: invalidate,
  });
}
