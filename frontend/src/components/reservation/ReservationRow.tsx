// Rezervasyon liste satırı — ders, çalışma alanı ve deneme oturumu için AYNI.
//
// ## Neden satır, neden kart değil
//
// Rezervasyon listesi homojen ve karşılaştırmalı içeriktir: kullanıcı "bu hafta
// ne var" diye tarar. NN/g'nin ölçümü bu durumda tutarlı liste satırını
// gösteriyor; dekoratif kartlar ekranda daha az içerik gösterir ve göz izleme
// çalışmalarında yarı-rastgele tarama üretir.
//
// ## Neden aksiyon YOK
//
// İptal/değiştir satırda değil detaydadır (Resy · Zocdoc · Doctolib · Preply
// hepsi böyle). Satırdaki aksiyon, tarama ritmini bozar ve yanlışlıkla
// tıklanır. Satırın tek işi: ne, ne zaman, nerede, hangi durumda.
import { Link } from "react-router-dom";

import { ReservationStatusBadge } from "./ReservationStatusBadge";
import { SOLUK_DURUMLAR } from "@/lib/reservationStatus";
import { formatTRY } from "@/lib/money";
import { goreliGun, mutlakZaman, tarihCipasi } from "@/lib/reservationTime";
import type { ReservationItem, ReservationKind } from "@/lib/reservationModel";

const TUR_ETIKETI: Record<ReservationKind, string> = {
  ders: "Ders",
  calisma: "Çalışma alanı",
  deneme: "Deneme sınavı",
};

export function ReservationRow({ item, to }: { item: ReservationItem; to: string }) {
  const cipa = tarihCipasi(item.baslangic);
  const goreli = goreliGun(item.baslangic);
  const soluk = SOLUK_DURUMLAR.has(item.durum);

  return (
    <Link
      to={to}
      className={`flex items-center gap-4 px-4 py-4 transition hover:bg-slate-50 sm:px-5 ${
        soluk ? "opacity-60" : ""
      }`}
    >
      {/* Sol çıpa: göz önce buraya düşer, satırlar hizalı taranır. */}
      <div className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-slate-50 py-2 text-center">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {cipa.gun}
        </span>
        <span className="text-lg font-semibold leading-tight tabular-nums text-slate-900">
          {cipa.sayi}
        </span>
        <span className="text-[11px] uppercase tracking-wide text-slate-400">{cipa.ay}</span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{item.baslik}</p>
        <p className="truncate text-sm text-slate-500">
          {TUR_ETIKETI[item.tur]}
          {item.altBaslik && <> · {item.altBaslik}</>}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {mutlakZaman(item.baslangic, item.bitis)}
          {goreli && <> · {goreli}</>}
          {/* Tutar satırda kalır: ödenmemiş kayıtta kullanıcı "Ödemeyi
              tamamla"ya basmadan ÖNCE ne ödeyeceğini bilmeli. Ders listesi
              (`LessonRow`) da aynısını yapıyor. */}
          {item.tutar && <> · {formatTRY(item.tutar)}</>}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ReservationStatusBadge durum={item.durum} />
        <span aria-hidden className="text-slate-300">
          ›
        </span>
      </div>
    </Link>
  );
}
