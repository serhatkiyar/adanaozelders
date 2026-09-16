import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { CategoryBar, type CategoryKey } from "@/components/CategoryBar";
import { MobilAramaSheet } from "@/components/MobilAramaSheet";
import { AramaAdimlari } from "@/components/kesif/AramaAdimlari";
import type { DersSekli } from "@/components/AramaSecicileri";
import { useDebounce } from "@/hooks/useDebounce";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import {
  EGITMEN_ARAMA,
  KUTUPHANE_ARAMA,
  dersSorgusu,
  egitmenAramaAdresi,
  type EgitmenAramasi,
} from "@/lib/aramaUrl";
import { PATHS } from "@/lib/routes";
import { type YerSecimi, ilceListesindenYer, yerinIlceleri } from "@/lib/yerArama";

/* ────────────────────────────────────────────────────────────────────────────
   TELEFONDAKİ ADIMLI ARAMA AKIŞI — tek yer.

   Yüzeyin kendisi `AramaAdimlari`, kabı `MobilAramaSheet`. Burada olan şey
   ikisinin ARASI: hangi kategori, taslak seçimler nereden geliyor ve "Ara"ya
   basınca nereye gidiliyor.

   ## Neden ayrı bir bileşen

   Akış üç ekrandan açılıyor: ana sayfa, kütüphane listesi ve EĞİTMEN SONUÇ
   EKRANI (kullanıcı kararı, 11 Eyl 2026 — sonuç ekranındaki arama çubuğuna
   dokununca da aynı yüzey açılsın). İlk ikisi keşif kabuğunun çocuğu,
   üçüncüsü bilerek değil (bkz. `KesifKabugu` "Sınır" başlığı). Kabuğa
   koyulsaydı sonuç ekranı yüzeyi hiç göremezdi; sonuç ekranına kopyalansaydı
   aynı model iki dosyada yaşardı.

   ## Taslak seçimler ADRESTEN doğar

   Sonuç ekranında yüzey BOŞ açılmamalı: kullanıcı zaten bir arama yapmış,
   dokunma sebebi onu düzenlemek. O yüzden açılışta adresteki arama taslağa
   çözülür. Ana sayfada adres boştur, taslak da boş açılır — eski davranış.

   ## "Ara" iki farklı şey yapar ve bu bilinçli

   - Sonuç ekranındaysak adres DÜZENLENİR (`ayarla`): sıralama, fiyat, yaş,
     cinsiyet gibi kullanıcının kurduğu öteki filtreler yerinde kalır. Yeni
     bir adres kurmak onları sessizce siler.
   - Başka bir ekrandaysak yeni arama adresine GEZİNİLİR.
   ──────────────────────────────────────────────────────────────────────── */

/** Adresteki arama → adımlı yüzeyin taslağı. */
function taslagaCoz(d: EgitmenAramasi) {
  return {
    /* Katalogdan seçilmiş ders `ders`te, serbest metin `q`da yaşar
       (`dersSorgusu`); yüzeyde ikisi de aynı kutuyu doldurur. */
    ders: d.ders[0] ?? "",
    dersEtiket: d.ders[0] ?? d.q,
    /* Yüzey TEK şekil sorar; adres çoklu taşıyabilir, ilki alınır. */
    sekil: (d.sekil[0] ?? "") as DersSekli,
    yer: ilceListesindenYer(d.konum.yer, d.konum.ilce),
    yakinimda: d.yakinimda,
  };
}

export function MobilAramaAkisi({
  acik,
  onKapat,
}: {
  acik: boolean;
  onKapat: () => void;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const kategori: CategoryKey =
    pathname === PATHS.libraries ? "kutuphaneler" : "egitmenler";
  const kutuphaneMi = kategori === "kutuphaneler";
  const sonucEkraninda = pathname === PATHS.tutors;

  /* ── Eğitmen tarafı: TASLAK ──
     Seçimler yazdıkça adrese yazılmaz; altta canlı filtrelenen bir liste
     olsa bile yüzey tam ekran kapatıyor, ara sonuç kimseye görünmüyor.
     Adres tek seferde, "Ara"da yazılır. */
  const { degerler: eDegerler, ayarla: eAyarla } = useAramaDurumu(EGITMEN_ARAMA);
  const [taslak, setTaslak] = useState(() => taslagaCoz(eDegerler));

  /* Her AÇILIŞTA adresten tazelenir: bir önceki aramanın taslağı ekranda
     kalmasın. `useEffect` DEĞİL, çizim sırasında (React'in "prop değişince
     durumu düzelt" deseni): efektle yapılsaydı yüzey ilk kareyi ESKİ taslakla
     çizer, altındaki `AramaAdimlari` de adım durumunu o eski değerlerden
     tohumlardı. Adres taslak yüzünden değil "Ara" yüzünden değiştiği için
     tazeleme yalnız açılışa bağlı. */
  const [oncekiAcik, setOncekiAcik] = useState(acik);
  if (acik !== oncekiAcik) {
    setOncekiAcik(acik);
    if (acik) setTaslak(taslagaCoz(eDegerler));
  }

  /* Adreste zaten bir arama varsa yüzey DÜZENLEME kipindedir: kullanıcı sıfırdan
     kurmuyor, mevcut aramanın bir alanını değiştiriyor. Adımlar yanıtlanmış
     sayılır ve tek bir değişiklik doğrudan arar — yoksa yerini değiştiren
     kullanıcıya, hiç sormadığı ders şekli adımı açılıyordu. */
  const duzenleme =
    sonucEkraninda &&
    (eDegerler.q.trim() !== "" ||
      eDegerler.ders.length > 0 ||
      eDegerler.konum.ilce.length > 0 ||
      eDegerler.konum.yer !== null ||
      eDegerler.yakinimda);

  const yaz = (parca: Partial<ReturnType<typeof taslagaCoz>>) =>
    setTaslak((o) => ({ ...o, ...parca }));

  const araEgitmen = () => {
    const alan = {
      ...dersSorgusu(taslak.ders, taslak.dersEtiket),
      sekil: taslak.sekil ? [taslak.sekil] : [],
      konum: {
        yer: taslak.yer?.tur === "mahalle" ? taslak.yer : null,
        ilce: yerinIlceleri(taslak.yer),
      },
      yakinimda: taslak.yakinimda,
    };
    if (sonucEkraninda) eAyarla(alan);
    else navigate(egitmenAramaAdresi(alan));
  };

  /* ── Kütüphane tarafı: ADRESTE ──
     Yüzeyin altındaki liste adresi canlı okuyor; taslak tutmak ikinci bir
     doğruluk kaynağı yaratırdı. Yalnız serbest metin yerel + debounce'lu,
     çünkü her harf ayrı bir geçmiş girdisi olurdu. */
  const { degerler: kDegerler, ayarla: kAyarla } = useAramaDurumu(KUTUPHANE_ARAMA);
  const [kQ, setKQ] = useState(kDegerler.q);
  const kDebounced = useDebounce(kQ);

  useEffect(() => {
    if (!kutuphaneMi) return;
    setKQ((onceki) => (kDegerler.q !== onceki ? kDegerler.q : onceki));
  }, [kDegerler.q, kutuphaneMi]);

  useEffect(() => {
    if (!kutuphaneMi) return;
    if (kDebounced.trim() !== kDegerler.q)
      kAyarla({ q: kDebounced }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kDebounced, kutuphaneMi]);

  /* İlçe seçimi adreste `ilce` olarak yaşıyor, `yer` yalnız mahalleyi
     taşıyor; yüzey ikisini tek alanda gösterdiği için burada birleştirilir.
     Birleştirilmezse yüzey ikinci açılışta seçili ilçeyi UNUTMUŞ görünür. */
  const kIlce = kDegerler.konum.ilce[0];
  const kYer: YerSecimi | null =
    kDegerler.konum.yer ?? (kIlce ? { tur: "ilce", ilce: kIlce } : null);

  const setKYer = (v: YerSecimi | null) =>
    kAyarla({
      konum: { yer: v?.tur === "mahalle" ? v : null, ilce: yerinIlceleri(v) },
    });

  return (
    <MobilAramaSheet
      open={acik}
      onClose={onKapat}
      /* Tam ekran arama yüzeyinde şerit SEKME kipinde: çip, altındaki beyaz
         kartlarla yarışan ikinci bir kart dili üretiyordu. */
      ust={<CategoryBar active={kategori} sekmeKipi />}
    >
      <AramaAdimlari
        /* Kategori değişince adımlar BAŞTAN başlar: ilk adım kategoriye göre
           farklı (eğitmende "Ders", kütüphanede "Yer"). Anahtar olmadan
           eğitmenden kütüphaneye geçen kullanıcı kütüphanede hiç çizilmeyen
           "Ders" adımında kalıyor, ekranda tek bir açık kart bile
           kalmıyordu. */
        key={kutuphaneMi ? "kutuphane" : "egitmen"}
        kutuphaneMi={kutuphaneMi}
        duzenleme={duzenleme}
        ders={taslak.ders}
        dersEtiket={taslak.dersEtiket}
        onDersChange={(qDeger, etiket) =>
          yaz({ ders: qDeger, dersEtiket: etiket })
        }
        sekil={taslak.sekil}
        setSekil={(v) => yaz({ sekil: v })}
        yer={kutuphaneMi ? kYer : taslak.yer}
        setYer={kutuphaneMi ? setKYer : (v) => yaz({ yer: v })}
        kutuphaneQ={kQ}
        setKutuphaneQ={setKQ}
        yakinimda={kutuphaneMi ? kDegerler.yakinimda : taslak.yakinimda}
        setYakinimda={(v) =>
          kutuphaneMi ? kAyarla({ yakinimda: v }) : yaz({ yakinimda: v })
        }
        onAra={() => {
          onKapat();
          if (!kutuphaneMi) araEgitmen();
        }}
        onTemizle={() => {
          if (kutuphaneMi) {
            setKQ("");
            kAyarla({ konum: { yer: null, ilce: [] }, yakinimda: false });
          } else {
            setTaslak({
              ders: "",
              dersEtiket: "",
              sekil: "",
              yer: null,
              yakinimda: false,
            });
          }
        }}
      />
    </MobilAramaSheet>
  );
}
