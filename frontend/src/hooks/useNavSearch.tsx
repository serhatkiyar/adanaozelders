import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CategoryBar, type CategoryKey } from "@/components/CategoryBar";
import { CompactSearch, DersArama, KutuphaneArama } from "@/components/HeroSearch";
import { type DersSekli } from "@/components/AramaSecicileri";
import { type YerSecimi, yerinIlceleri } from "@/lib/yerArama";
import { dersSorgusu, egitmenAramaAdresi, kutuphaneAramaAdresi } from "@/lib/aramaUrl";

/* ─── useNavSearch ────────────────────────────────────────────────────────
   Detay sayfalarının (eğitmen/kütüphane ilanı) üst barına arama hapını
   taşır. Kendi sonuç listesi yoktur: Ara'ya basılınca ilgili arama
   sayfasına (/egitmenler veya /kutuphaneler) gider.

   ESKİ `BigSearch` BURADAN DA GİTTİ (kullanıcı, 16 Eyl 2026: "ilandan
   girince o çubuğun açtığı şey eski filtre şeyi, artık kullanmıyoruz").
   Açılan geniş arama artık her yerdeki hapın kendisi: eğitmende ders + ders
   şekli + yer (Merkez / Yakınımda dahil), kütüphanede yalnız yer. Kategori
   sekmesi formu değiştirir, sayfayı değil (bkz. `CategoryBar.onSec`).
   Nöbetçi: `__guards__/aramaHapiIkizligi.test.ts` — eski hap artık hiçbir
   dosyada basılmaz. */
export function useNavSearch(active: CategoryKey = "egitmenler") {
  const navigate = useNavigate();
  // Kompakt pill'e tıklayınca geniş navbar (kategoriler + hap) açılır.
  const [open, setOpen] = useState(false);
  const [aramaKategori, setAramaKategori] = useState<CategoryKey>(active);

  /* Taslaklar yereldir: ilan sayfasının adresinde arama durumu yaşamaz. */
  const [ders, setDers] = useState("");
  const [dersEtiket, setDersEtiket] = useState("");
  const [sekil, setSekil] = useState<DersSekli>("");
  const [yer, setYer] = useState<YerSecimi | null>(null);
  const [yakinimda, setYakinimda] = useState(false);
  const [kYer, setKYer] = useState<YerSecimi | null>(null);
  const [kYakinimda, setKYakinimda] = useState(false);

  const submitEgitmen = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(
      egitmenAramaAdresi({
        ...dersSorgusu(ders, dersEtiket),
        sekil: sekil ? [sekil] : [],
        konum: {
          yer: yer?.tur === "mahalle" ? yer : null,
          ilce: yerinIlceleri(yer),
        },
        yakinimda,
      })
    );
    setOpen(false);
  };

  const submitKutuphane = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(
      kutuphaneAramaAdresi({
        konum: {
          yer: kYer?.tur === "mahalle" ? kYer : null,
          ilce: yerinIlceleri(kYer),
        },
        yakinimda: kYakinimda,
      })
    );
    setOpen(false);
  };

  /* ── Navbar ortası: kapalı → kompakt pill, açık → kategori sekmeleri. ── */
  const center = (
    <div
      key={open ? "cats" : "compact"}
      className="w-full animate-in fade-in duration-300"
    >
      {open ? (
        <CategoryBar active={aramaKategori} onSec={setAramaKategori} />
      ) : (
        <div className="flex w-full justify-center">
          {/* İlan sayfasında arama bağlamı yok; hap yalnız davet taşır
              (kullanıcı, 16 Eyl 2026: her yüzeyde "Aramaya başlayın"). */}
          <CompactSearch
            active={active}
            placeholder="Aramaya başlayın"
            parcalar={[]}
            onOpen={() => setOpen(true)}
          />
        </div>
      )}
    </div>
  );

  /* ── Navbar altı: yalnız açıkken hap; kapalıyken satır yok. ── */
  const bottom = open ? (
    <div className="flex justify-center px-4 pb-3 pt-1 sm:px-6">
      {aramaKategori === "kutuphaneler" ? (
        <KutuphaneArama
          yer={kYer}
          setYer={(v) => {
            setKYer(v);
            if (v) setKYakinimda(false);
          }}
          yakinimda={kYakinimda}
          setYakinimda={(v) => {
            setKYakinimda(v);
            if (v) setKYer(null);
          }}
          onSubmit={submitKutuphane}
        />
      ) : (
        <DersArama
          ders={ders}
          dersEtiket={dersEtiket}
          onDersChange={(qDeger, etiket) => {
            setDers(qDeger);
            setDersEtiket(etiket);
          }}
          sekil={sekil}
          setSekil={setSekil}
          yer={yer}
          setYer={setYer}
          yakinimda={yakinimda}
          setYakinimda={setYakinimda}
          onSubmit={submitEgitmen}
        />
      )}
    </div>
  ) : undefined;

  return { center, bottom, open, setOpen };
}
