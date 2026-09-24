/**
 * Katılımcılar — Meet `ParticipantsList` + `ParticipantRow` +
 * `ParticipantsCollapsibleSection` (La Suite Meet, MIT — DINUM/Etalab).
 *
 * Yönetici işlemleri (başkasını susturma, çıkarma, lobi, el indirme) YOK:
 * birebir derste karşılıkları yok ve arayüz host'a özel API çağırmaz. Satır:
 * avatar, ad ("(sen)"), rol (sitenin tek rol etiketi kaynağı `rolEtiketi`),
 * mikrofon durumu. Kendi mikrofonun açıksa Meet'teki gibi buradan kapatılır.
 */
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";
import { katilimciRengi } from "@/lib/canliDers";
import { rolEtiketi } from "@/lib/roles";
import { ROLE_IDS, type ZoomDersTokenOut } from "@/types";

import type { Katilimci } from "../zoom/indirgeyiciler";
import { useEliKalkik, useKonusuyor, useOdaDeposu } from "../zoom/odaDeposu";
import { useMedyaKontrolleri } from "../zoom/useMedyaKontrolleri";
import { Avatar } from "./Avatar";

const rolKimligi = (rol: ZoomDersTokenOut["rol"]) =>
  rol === "host" ? ROLE_IDS.TUTOR : ROLE_IDS.CLIENT;

export function KatilimciListesi({ benimRolum }: { benimRolum: ZoomDersTokenOut["rol"] }) {
  const { t } = useTranslation();
  // Ham alanlar seçilir, liste dışarıda türetilir: seçicide yeni dizi
  // üretmek her depo değişiminde yeniden çizim döngüsü doğururdu.
  const katilimcilar = useOdaDeposu((d) => d.katilimcilar);
  const benId = useOdaDeposu((d) => d.benId);
  const [acik, setAcik] = useState(true);
  const bolumId = useId();

  // Meet: önce kendin, sonra diğerleri ada göre.
  const liste = useMemo(() => {
    const ben = katilimcilar.filter((k) => k.userId === benId);
    const digerleri = katilimcilar
      .filter((k) => k.userId !== benId)
      .sort((a, b) => a.ad.localeCompare(b.ad, "tr"));
    return [...ben, ...digerleri];
  }, [katilimcilar, benId]);

  const karsiRol = benimRolum === "host" ? "katilimci" : "host";
  const baslik = t("participants.contributors");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-4">
      <h2 className="mb-3 px-6 text-sm font-bold uppercase text-slate-600">
        {t("participants.subheading")}
      </h2>
      <div className="px-4">
        <PlainButton
          onClick={() => setAcik((a) => !a)}
          aria-expanded={acik}
          aria-controls={bolumId}
          aria-label={t(`participants.collapsable.${acik ? "close" : "open"}`, { name: baslik })}
          className="flex w-full items-center justify-between rounded-ders px-2 py-2 text-left text-sm font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
        >
          <span>
            {baslik} <span className="font-normal text-slate-500">({liste.length})</span>
          </span>
          <Icon
            name="chevronUp"
            className={`h-5 w-5 text-slate-500 transition-transform ${acik ? "" : "rotate-180"}`}
          />
        </PlainButton>
        <ul id={bolumId} role="list" className={acik ? "mt-1" : "hidden"}>
          {liste.map((k) => (
            <KatilimciSatiri
              key={k.userId}
              k={k}
              ben={k.userId === benId}
              rol={rolEtiketi(rolKimligi(k.userId === benId ? benimRolum : karsiRol))}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function KatilimciSatiri({ k, ben, rol }: { k: Katilimci; ben: boolean; rol: string }) {
  const { t } = useTranslation();
  const renk = useMemo(() => katilimciRengi(k.ad), [k.ad]);
  return (
    <li className="flex w-full items-center justify-between gap-2 px-2 py-1">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="h-9 w-9 shrink-0">
          <Avatar ad={k.ad} renk={renk} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-slate-900">
            {k.ad}
            {ben && <span className="font-normal text-slate-500"> ({t("participants.you")})</span>}
          </span>
          {rol && <span className="text-xs text-slate-500">{rol}</span>}
        </div>
      </div>
      <ElGostergesi userId={k.userId} />
      <MikGostergesi k={k} ben={ben} />
    </li>
  );
}

/** Meet `RaisedHandRow` yerine satırda el simgesi (birebir derste iki kişi). */
function ElGostergesi({ userId }: { userId: number }) {
  const { t } = useTranslation();
  if (!useEliKalkik(userId)) return null;
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-marka/15 text-marka-metin"
      role="img"
      aria-label={t("participantTile.handRaised")}
    >
      <Icon name="handRight" className="h-5 w-5" />
    </span>
  );
}

/** Meet `MicIndicator`: yalnız kendi açık mikrofonun kapatılabilir. */
function MikGostergesi({ k, ben }: { k: Katilimci; ben: boolean }) {
  const { t } = useTranslation();
  const konusuyor = useKonusuyor(k.userId);
  const m = useMedyaKontrolleri();
  const kutu = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded";

  if (k.mikKapali) {
    return (
      <span className={`${kutu} text-slate-400`} role="img" aria-label={t("participants.micOff")}>
        <Icon name="micOff" className="h-5 w-5" />
      </span>
    );
  }
  const ikon = (
    <Icon
      name="mic"
      className={`h-5 w-5 ${konusuyor ? "animate-pulse text-marka-metin" : "text-slate-700"}`}
    />
  );
  if (!ben) {
    return (
      <span className={kutu} role="img" aria-label={t("participants.micOn")}>
        {ikon}
      </span>
    );
  }
  return (
    <PlainButton
      onClick={() => void m.mikDegistir(false)}
      disabled={m.mesgul === "mik"}
      aria-label={t("participants.muteYourself")}
      title={t("participants.muteYourself")}
      className={`${kutu} hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus disabled:opacity-60`}
    >
      {ikon}
    </PlainButton>
  );
}
