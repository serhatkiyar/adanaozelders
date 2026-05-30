import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/api/auth";
import { useAuthStore } from "@/store/authStore";

// Token varsa /auth/me ile aktif kullanıcıyı çeker ve store'a yazar.
export function useCurrentUser() {
  const token = useAuthStore((s) => s.token);
  const setUser = useAuthStore((s) => s.setUser);

  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const user = await fetchMe();
      setUser(user);
      return user;
    },
    enabled: !!token,
    staleTime: Infinity,
    retry: false,
  });
}
