// Müşteri/kullanıcı detayı — eski AdminUserDetailPage'in verisi ve hesap silme akışı, panel düzeninde.
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Flex, Tag, Typography, theme } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { HesapSilmePenceresi } from "@/panel/pages/musteriler/MusteriDetayPencereleri";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { deleteAdminUser } from "@/api/admin";
import { useAdminUser } from "@/hooks/useAdmin";
import { formatDateTime } from "@/lib/datetime";
import { getErrorDetail, getErrorMessage } from "@/lib/errors";
import { rolEtiketi } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { ROLE_IDS } from "@/types";
import type { AdminUserRolePath } from "@/types";

const VALID_ROLES = new Set<AdminUserRolePath>(["admin", "tutor", "client"]);
const httpDurumu = (e: unknown) => (e as { response?: { status?: number } } | null)?.response?.status;

export function MusteriDetayi() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { role: rawRole, id: rawId } = useParams();
  const role = rawRole && VALID_ROLES.has(rawRole as AdminUserRolePath) ? (rawRole as AdminUserRolePath) : undefined;
  // Yalnız kanonik pozitif tam sayı ("1e3", "0x10", " 42 " reddedilir).
  const id = rawId !== undefined && /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  const gecerli = role !== undefined && Number.isSafeInteger(id) && id > 0;
  const { canView, canManage } = useAdminAreaAccess("users");
  // İzinsiz ya da geçersiz bağlantıda detay isteği hiç atılmaz.
  const sorgu = useAdminUser(role, id, canView && gecerli);
  const user = sorgu.data;
  // Yalnız tutor/client silinebilir; admin veya geçersiz rolde mutation hiçbir yoldan çalışmaz.
  const silinebilirRol: "tutor" | "client" | null = role === "tutor" || role === "client" ? role : null;

  const [silmeAcik, setSilmeAcik] = useState(false);
  const [silmeHatasi, setSilmeHatasi] = useState<string | null>(null);
  // Senkron gönderim kilidi: aynı tick içindeki ikinci çağrı render state'ini beklemeden düşer.
  const gonderiliyorRef = useRef(false);
  const geriDon = () => navigate(ROUTES.adminNewCustomers);

  const sil = useMutation({
    mutationFn: (reason: string) => {
      if (!silinebilirRol) return Promise.reject(new Error("Bu hesap silinemez."));
      return deleteAdminUser({ role: silinebilirRol, user_id: id, reason });
    },
    onSuccess: () => {
      message.success(`${user?.full_name ?? "Hesap"} hesabı anonimleştirilip kapatıldı.`);
      // Silinen hesabın detayı önbellekte kalmasın (geri tuşuyla dönüşte eski profil görünmesin).
      qc.removeQueries({ queryKey: ["admin", "users", "detail", role, id] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      geriDon();
    },
    onError: (e) => setSilmeHatasi(getErrorDetail(e, "Hesap silinemedi.")),
    onSettled: () => {
      gonderiliyorRef.current = false;
    },
  });

  if (!canView) return <AccessDenied area="Müşteriler" />;
  if (!gecerli) {
    return <HataDurumu hata="Kullanıcı bağlantısı geçerli bir rol ve kimlik içermiyor." hataAksiyon={<Button size="small" onClick={geriDon}>Müşterilere dön</Button>} />;
  }
  if (sorgu.isError) {
    if (httpDurumu(sorgu.error) === 404) {
      return <HataDurumu hata="Kullanıcı bulunamadı." hataAksiyon={<Button size="small" onClick={geriDon}>Müşterilere dön</Button>} />;
    }
    return (
      <HataDurumu
        hata={getErrorMessage(sorgu.error, "Kullanıcı detayı yüklenemedi.")}
        hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
      />
    );
  }
  if (sorgu.isPending || !user) return <YukleniyorDurumu etiket="Kullanıcı yükleniyor…" />;

  const kart = { background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4, padding: 24 };
  const silinebilir = canManage && silinebilirRol !== null;

  const hesap: [string, string][] = [
    ["E-posta", user.email],
    ["E-posta doğrulama", user.email_verified ? "Doğrulandı" : "Doğrulanmadı"],
    ["Rol", rolEtiketi(ROLE_IDS[user.role])],
    ["Kayıt", formatDateTime(user.created_at)],
    ["Son güncelleme", formatDateTime(user.updated_at)],
    ["Son görülme", user.last_seen_at ? formatDateTime(user.last_seen_at) : "Henüz yok"],
    ...(user.tutor_status ? ([["İlan durumu", user.tutor_status]] as [string, string][]) : []),
  ];
  const etkinlik: [string, number][] = [
    ["Rezervasyon", user.booking_count],
    ["Değerlendirme", user.review_count],
    ...(user.role === "CLIENT" ? ([["Talep", user.demand_count], ["Sipariş", user.order_count]] as [string, number][]) : []),
  ];

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Flex align="center" gap={12} style={{ minWidth: 0 }}>
          <Button aria-label="Geri" icon={<ArrowLeftOutlined />} onClick={geriDon} />
          <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>{user.full_name}</Typography.Title>
          <Tag color={user.is_active ? "success" : "default"}>{user.is_active ? "Aktif" : "Pasif"}</Tag>
          <Tag color="processing">{rolEtiketi(ROLE_IDS[user.role])}</Tag>
        </Flex>
        {silinebilir ? (
          <Button danger onClick={() => { setSilmeHatasi(null); setSilmeAcik(true); }}>Hesabı sil</Button>
        ) : null}
      </Flex>

      <section aria-label="Hesap bilgileri" style={kart}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          {hesap.map(([k, v]) => (
            <div key={k} style={{ minWidth: 0 }}>
              <Typography.Text style={{ fontWeight: 500, color: token.colorTextTertiary, display: "block" }}>{k}</Typography.Text>
              <Typography.Text style={{ overflowWrap: "anywhere" }}>{v}</Typography.Text>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Etkinlik özeti" style={kart}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
          {etkinlik.map(([k, v]) => (
            <div key={k}>
              <Typography.Text style={{ fontWeight: 500, color: token.colorTextTertiary, display: "block" }}>{k}</Typography.Text>
              <Typography.Text style={{ fontSize: 24, fontWeight: 500, lineHeight: "32px" }}>{v}</Typography.Text>
            </div>
          ))}
        </div>
      </section>

      {silinebilir ? (
        <HesapSilmePenceresi
          acik={silmeAcik}
          kapat={() => setSilmeAcik(false)}
          fullName={user.full_name}
          kaydediyor={sil.isPending}
          hata={silmeHatasi}
          onayla={(reason) => {
            // Sürerken ikinci istek yok; gönderilen gerekçe çağrı anında sabitlenir.
            if (gonderiliyorRef.current || sil.isPending || !silinebilirRol) return;
            gonderiliyorRef.current = true;
            setSilmeHatasi(null);
            sil.mutate(reason);
          }}
        />
      ) : null}
    </Flex>
  );
}
