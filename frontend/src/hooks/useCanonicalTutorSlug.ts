import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ROUTES, tutorSlug } from "@/lib/routes";

// URL'deki slug kanonik değilse (örn. /egitmenler/42 ya da bayat slug),
// /egitmenler/ahmet-yilmaz-42'ye sessizce (replace) yönlendirir — temiz/SEO URL.
export function useCanonicalTutorSlug(
  tutor: { id: number; slug?: string | null } | undefined
) {
  const { slug: current } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (!tutor) return;
    const canonical = tutorSlug(tutor);
    if (current && current !== canonical) {
      navigate(ROUTES.tutor(canonical), { replace: true });
    }
  }, [tutor, current, navigate]);
}
