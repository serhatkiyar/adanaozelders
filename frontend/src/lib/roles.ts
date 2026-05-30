import { ROLE_IDS } from "@/types";

// role_id'ye göre asimetrik ana sayfa yönlendirmesi.
export function roleHome(roleId: number | null | undefined): string {
  switch (roleId) {
    case ROLE_IDS.ADMIN:
      return "/admin";
    case ROLE_IDS.TUTOR:
      return "/tutor";
    case ROLE_IDS.CLIENT:
      return "/student";
    default:
      return "/login";
  }
}
