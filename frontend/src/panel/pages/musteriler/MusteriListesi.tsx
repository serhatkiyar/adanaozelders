import { useMemo, useState } from "react";
import { Button, Tag } from "antd";
import type { TableProps } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { ListePage } from "@/panel/components/ListePage";
import { useAdminUsers } from "@/hooks/useAdmin";
import { useDebounce } from "@/hooks/useDebounce";
import { formatDateTime } from "@/lib/datetime";
import { rolEtiketi } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { ROLE_IDS } from "@/types";
import type { AdminUserOut, AdminUserRole } from "@/types";

/**
 * `AdminUserOut.role` API'nin döndüğü rol ADI (`"CLIENT"`); `lib/roles.ts`
 * TEK KAYNAK etiket tablosu rol KİMLİĞİYLE (sayı) anahtarlanır — eski panelin
 * `AdminUsersPage.tsx`teki AYNI köprü (bkz. oradaki `ROLE_ID`).
 */
const ROLE_ID: Record<AdminUserRole, number> = {
  ADMIN: ROLE_IDS.ADMIN,
  TUTOR: ROLE_IDS.TUTOR,
  CLIENT: ROLE_IDS.CLIENT,
};

/**
 * Müşteriler modülünün ilk ekranı — yalnız liste (bkz. spec).
 *
 * ## Kapsam: `role: "CLIENT"` sabit sunucu filtresi
 *
 * `panel/layout/menu.ts` "Müşteriler"i "Eğitmenler"den AYRI bir modül olarak
 * listeler (bkz. `PANEL_MENU` — bu ayrım bu paketten ÖNCE karara bağlanmıştı,
 * burada icat edilmedi). `AdminUsersParams.role` (bkz. `api/admin.ts`)
 * zaten bir rol filtresi sunuyor; bu ekran onu kullanıcıya açık bir filtre
 * olarak DEĞİL (YAGNI: filtre çekmecesi kapsam dışı), sabit bir sunucu
 * parametresi olarak `role: "CLIENT"` verir. Sonuç: liste yalnız
 * müşterileri gösterir, eğitmen/admin hesapları hiç gelmez.
 *
 * ## Arama GERÇEK (sunucuya gider) — Siparişler'den FARKLI
 *
 * `AdminUsersParams.q` (bkz. `api/admin.ts` `fetchAdminUsers`) sunucuda
 * DESTEKLENİYOR — `SiparisListesi`teki "yalnız bu sayfada arıyor" uyarı
 * şeridine gerek yok, çünkü arama gerçekten TÜM müşterilerde (sayfalar
 * arası) çalışır. Desen `UrunListesi`den alındı: girdi anında güncellenir,
 * API'ye giden değer `useDebounce` ile gecikmelidir (yoksa her tuş vuruşu
 * ayrı bir istek demektir). Arama başladığında sayfa 1'e döner — eski
 * sayfadaki `offset` yeni sorguda anlamsız kalabilir (bkz. `UrunListesi`teki
 * aynı emsal).
 *
 * ## PII — eski panelin davranışı KORUNDU
 *
 * `AdminUserOut`ta `phone` alanı YOK (bkz. `types/index.ts`) — uydurulmadı.
 * `email` eski `AdminUsersPage.tsx`te olduğu gibi MASKELENMEDEN gösterilir;
 * bu ekran yeni bir maskeleme kuralı icat etmez, eski panel ne yapıyorsa
 * onu yapar (root `CLAUDE.md`: PII uçlarında mevcut servis desenini takip
 * et).
 */
export function MusteriListesi() {
  const [arama, setArama] = useState("");
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(20);

  // Girdi anında güncellenir (aramaDegeri); API'ye giden değer gecikmelidir.
  const gecikmisArama = useDebounce(arama);

  const { data, isPending, isError, refetch } = useAdminUsers({
    role: "CLIENT",
    q: gecikmisArama || undefined,
    limit: boyut,
    offset: (sayfa - 1) * boyut,
  });

  const musteriler = data?.items ?? [];
  // `fetchAdminUsers` `total`ı HER ZAMAN gerçek bir sayı döner (`X-Total-Count`
  // yoksa `items.length`e düşer) — Siparişler'deki `-1` sentinel'i burada YOK
  // (bkz. `api/admin.ts`), sayı uydurulmaz.
  const toplam = data?.total;

  const navigate = useNavigate();
  // Liste yalnız CLIENT gösterir; detay bağlantısı `client` rolüyle kurulur.
  const kolonlar: TableProps<AdminUserOut>["columns"] = useMemo(() => {
    const satirTiklama = (k: AdminUserOut) => ({
      onClick: () => navigate(ROUTES.adminNewCustomer("client", k.id)),
      style: { cursor: "pointer" },
    });
    return [
      {
        title: "Ad Soyad",
        dataIndex: "full_name",
        key: "full_name",
        // Gerçek bağlantı: orta/Ctrl tık çalışır; satır olayı ikinci kez tetiklenmez.
        render: (v: string, k: AdminUserOut) => (
          <Link to={ROUTES.adminNewCustomer("client", k.id)} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 500 }}>
            {v}
          </Link>
        ),
        onCell: satirTiklama,
      },
      { title: "E-posta", dataIndex: "email", key: "email", onCell: satirTiklama },
      {
        title: "Rol",
        dataIndex: "role",
        key: "role",
        render: (v: AdminUserRole) => rolEtiketi(ROLE_ID[v]),
        onCell: satirTiklama,
      },
      {
        title: "Durum",
        dataIndex: "is_active",
        key: "is_active",
        render: (v: boolean) => <Tag color={v ? "success" : "default"}>{v ? "Aktif" : "Pasif"}</Tag>,
        onCell: satirTiklama,
      },
      {
        title: "Kayıt Tarihi",
        dataIndex: "created_at",
        key: "created_at",
        render: (v: string) => formatDateTime(v),
        onCell: satirTiklama,
      },
    ];
  }, [navigate]);

  return (
    <ListePage<AdminUserOut>
      baslik="Müşteriler"
      aramaDegeri={arama}
      aramaDegisti={(v) => {
        setArama(v);
        setSayfa(1);
      }}
      kolonlar={kolonlar}
      veri={musteriler}
      yukleniyor={isPending}
      hata={isError ? "Müşteriler yüklenemedi." : null}
      hataAksiyon={<Button onClick={() => refetch()}>Tekrar dene</Button>}
      toplam={toplam}
      sayfa={sayfa}
      sayfaBoyutu={boyut}
      sayfaDegisti={(s, b) => {
        setSayfa(s);
        setBoyut(b);
      }}
      bosBaslik={arama ? "Sonuç bulunamadı" : "Henüz müşteri yok"}
      bosAciklama={
        arama
          ? "Farklı bir arama deneyin."
          : "İlk müşteri kayıt olduğunda burada görünecek."
      }
      rowKey={(k) => k.id}
    />
  );
}
