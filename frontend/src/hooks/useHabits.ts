import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkInHabit,
  createHabit,
  deleteHabit,
  fetchHabits,
  updateHabit,
} from "@/api/habits";
import { todayISO } from "@/lib/habit";
import { useAuthStore } from "@/store/authStore";
import type { HabitCreate } from "@/types";

// Sorgu anahtarı bugünün yerel gününü içerir; gün dönünce otomatik tazelenir.
const habitsKey = (on: string) => ["habits", on] as const;

export function useHabits() {
  const token = useAuthStore((s) => s.token);
  const on = todayISO();
  return useQuery({
    queryKey: habitsKey(on),
    queryFn: () => fetchHabits(on),
    enabled: !!token,
  });
}

function useInvalidateHabits() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["habits"] });
}

export function useCreateHabit() {
  const invalidate = useInvalidateHabits();
  return useMutation({
    mutationFn: (payload: HabitCreate) => createHabit(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateHabit() {
  const invalidate = useInvalidateHabits();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<HabitCreate> }) =>
      updateHabit(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteHabit() {
  const invalidate = useInvalidateHabits();
  return useMutation({
    mutationFn: (id: number) => deleteHabit(id),
    onSuccess: invalidate,
  });
}

export function useCheckInHabit() {
  const invalidate = useInvalidateHabits();
  const on = todayISO();
  return useMutation({
    mutationFn: ({
      id,
      delta,
      entryDate,
    }: {
      id: number;
      delta: number;
      entryDate?: string;
    }) => checkInHabit(id, entryDate ?? on, delta, on),
    onSuccess: invalidate,
  });
}
