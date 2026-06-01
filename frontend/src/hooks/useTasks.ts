import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSubtask,
  createTask,
  createTaskList,
  deleteSubtask,
  deleteTask,
  deleteTaskList,
  fetchTaskLists,
  fetchTasks,
  toggleTask,
  updateSubtask,
  updateTask,
  updateTaskList,
} from "@/api/tasks";
import { useAuthStore } from "@/store/authStore";
import type {
  TaskCreate,
  TaskListCreate,
  TaskStatusFilter,
  TaskUpdate,
} from "@/types";

const TASKS_ROOT = ["tasks"] as const;
const LISTS_KEY = ["tasks", "lists"] as const;
const tasksKey = (listId: number | null, status: TaskStatusFilter) =>
  ["tasks", "items", listId ?? "all", status] as const;

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

export function useTasks(
  listId: number | null,
  status: TaskStatusFilter,
  enabled = true
) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: tasksKey(listId, status),
    queryFn: () => fetchTasks({ listId, status }),
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
