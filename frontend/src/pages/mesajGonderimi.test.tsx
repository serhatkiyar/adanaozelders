/**
 * Mesaj gönderimi — çift gönderim ve telefon kapısı regresyonları (28 Eyl 2026).
 *
 * - Gönderim sürerken ikinci Enter yeni istek AÇMAZ (eskiden iki mesaj
 *   gidiyor, öğrencinin "yanıt gelene kadar" hakkından iki kez düşüyordu).
 * - Telefonu doğrulanmamış kullanıcı gönderimden ÖNCE doğrulama yolunu görür;
 *   yazdığı taslak yerinde kalır.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Messages from "@/pages/Messages";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS } from "@/types";

let telefonDogrulandi = true;
const gonder = vi.fn();
// Kancalar SABİT nesne döndürür: her render'da yeni nesne, sayfadaki
// bağımlılık dizilerini her turda tetikleyip sonsuz render'a sokar.
const gonderim = { mutate: gonder, isPending: false };
const uygunluk = { data: undefined, refetch: vi.fn() };
const telefonMutasyonu = { mutate: vi.fn(), isPending: false };

const kullaniciSorgusu = () => ({
  data: {
    id: 7,
    role_id: ROLE_IDS.CLIENT,
    email: "o@example.com",
    email_verified: true,
    phone: null,
    phone_verified: telefonDogrulandi,
  },
  isLoading: false,
  isError: false,
});
let kullanici = kullaniciSorgusu();
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => kullanici,
}));

vi.mock("@/hooks/useProfile", () => ({
  useRequestPhoneOtp: () => telefonMutasyonu,
  useVerifyPhone: () => telefonMutasyonu,
}));

const bosMutasyon = { mutate: () => {}, isPending: false };
const bosListe = { data: [], isLoading: false };
const bosArama = { data: null, isLoading: false };
const okunmamis = { data: { inbox: 0, archived: 0 } };
vi.mock("@/hooks/useMessages", () => ({
  useConversations: () => bosListe,
  useMessageSearch: () => bosArama,
  useMessages: () => bosListe,
  useMessagesUnreadCount: () => okunmamis,
  useMarkConversationRead: () => bosMutasyon,
  useSendMessage: () => gonderim,
  useToggleReaction: () => bosMutasyon,
  useArchiveConversation: () => bosMutasyon,
  useMessagingEligibility: () => uygunluk,
  useBlockClient: () => bosMutasyon,
  useUnblockClient: () => bosMutasyon,
}));

function ekraniBas() {
  kullanici = kullaniciSorgusu();
  useAuthStore.setState({
    token: "t",
    user: { id: 7, role_id: ROLE_IDS.CLIENT, email: "o@example.com", email_verified: true },
  } as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[ROUTES.messageWith(1, "Elif", "TUTOR")]}>
        <Messages />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function yaz(metin: string) {
  const kutu = screen.getByRole("textbox", { name: "Mesajın" });
  fireEvent.change(kutu, { target: { value: metin } });
  return kutu;
}

beforeEach(() => {
  telefonDogrulandi = true;
  gonderim.isPending = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Mesaj gönderimi", () => {
  it("gönderim sürerken Enter ikinci istek açmaz", () => {
    gonderim.isPending = true;
    ekraniBas();
    const kutu = yaz("Merhaba, TYT matematik için ders almak istiyorum.");
    fireEvent.keyDown(kutu, { key: "Enter" });
    fireEvent.keyDown(kutu, { key: "Enter" });
    expect(gonder).not.toHaveBeenCalled();
  });

  it("boştayken Enter bir kez gönderir", () => {
    ekraniBas();
    const kutu = yaz("Merhaba, TYT matematik için ders almak istiyorum.");
    fireEvent.keyDown(kutu, { key: "Enter" });
    expect(gonder).toHaveBeenCalledTimes(1);
  });

  it("telefonu doğrulanmamış kullanıcı doğrulama yolunu görür, taslak kalır", () => {
    telefonDogrulandi = false;
    ekraniBas();
    expect(
      screen.getByText(/Mesaj göndermek için telefon numaranı doğrulaman gerekiyor/)
    ).toBeInTheDocument();

    const kutu = yaz("Merhaba hocam");
    fireEvent.keyDown(kutu, { key: "Enter" });

    expect(gonder).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Cep telefonu")).toBeInTheDocument();
    expect(kutu).toHaveValue("Merhaba hocam");
  });
});
