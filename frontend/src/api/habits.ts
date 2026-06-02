import { apiClient } from "@/api/axios";
import type { Habit, HabitCreate } from "@/types";

export async function fetchHabits(on: string): Promise<Habit[]> {
  const { data } = await apiClient.get<Habit[]>("/habits", { params: { on } });
  return data;
}

export async function createHabit(payload: HabitCreate): Promise<Habit> {
  const { data } = await apiClient.post<Habit>("/habits", payload);
  return data;
}

export async function updateHabit(
  id: number,
  payload: Partial<HabitCreate>
): Promise<Habit> {
  const { data } = await apiClient.patch<Habit>(`/habits/${id}`, payload);
  return data;
}

export async function deleteHabit(id: number): Promise<void> {
  await apiClient.delete(`/habits/${id}`);
}

export async function checkInHabit(
  id: number,
  entryDate: string,
  delta: number,
  on: string
): Promise<Habit> {
  const { data } = await apiClient.post<Habit>(`/habits/${id}/check`, {
    entry_date: entryDate,
    delta,
    on,
  });
  return data;
}
