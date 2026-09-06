import { Fragment, useState } from "react";

import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageSkeleton,
} from "@/components/admin/ui";
import { PlainButton } from "@/components/ui/PlainButton";
import {
  useAdminTutorPreApplications,
  useUpdateTutorPreApplicationStatus,
} from "@/hooks/useAdmin";
import type {
  AdminTutorPreApplication,
  PreApplicationStatus,
} from "@/api/admin";

const TR = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const EXPERIENCE_LABELS: Record<string, string> = {
  "universite-ogrencisi": "Üniversite öğrencisi",
  "0-2": "0–2 yıl",
  "3-5": "3–5 yıl",
  "5+": "5+ yıl",
};

function durumRozeti(status: PreApplicationStatus) {
  switch (status) {
    case "NEW":
      return <Badge tone="warning">Yeni</Badge>;
    case "CONTACTED":
      return <Badge tone="neutral">Arandı</Badge>;
    case "CONVERTED":
      return <Badge tone="success">Kazanıldı</Badge>;
    case "REJECTED":
      return <Badge tone="danger">Olumsuz</Badge>;
  }
}

/** Durumdan sonraki anlamlı geçişler — süreç telefonla yürür: yeni kayıt önce
 * aranır, aramadan sonra sonuçlanır. Sonuçlanmış kayıt geri açılabilir (yanlış
 * tık telafisi). */
function sonrakiAdimlar(
  status: PreApplicationStatus
): { label: string; to: PreApplicationStatus }[] {
  switch (status) {
    case "NEW":
      return [{ label: "Arandı", to: "CONTACTED" }];
    case "CONTACTED":
      return [
        { label: "Kazanıldı", to: "CONVERTED" },
        { label: "Olumsuz", to: "REJECTED" },
      ];
    case "CONVERTED":
    case "REJECTED":
      return [{ label: "Geri aç", to: "CONTACTED" }];
  }
}

const BICIM_LABELS: Record<string, string> = {
  ONLINE: "Online",
  IN_PERSON: "Yüz yüze",
  BOTH: "Online + yüz yüze",
};

/**
 * Formun isteğe bağlı bölümlerinden gelen alanlar. Tabloya kolon eklemek
 * yerine satır altında açılır: 6 kolonluk tablo 14 kolona çıksaydı mobil
 * kaydırma kullanılamaz hâle gelirdi ve operatörün asıl işi (numarayı arayıp
 * durumu ilerletmek) gürültüye gömülürdü.
 */
function DetaySatiri({ basvuru }: { basvuru: AdminTutorPreApplication }) {
  const satirlar: { etiket: string; deger: string | null }[] = [
    { etiket: "Başlık", deger: basvuru.headline },
    { etiket: "Ders biçimi", deger: basvuru.teaching_mode ? BICIM_LABELS[basvuru.teaching_mode] ?? basvuru.teaching_mode : null },
    { etiket: "Saatlik ücret", deger: basvuru.hourly_rate ? `${basvuru.hourly_rate} ₺` : null },
    { etiket: "Eğitim", deger: basvuru.education_note },
    { etiket: "Müsaitlik", deger: basvuru.availability_note },
  ].filter((s) => s.deger);

  const bosMu =
    satirlar.length === 0 && !basvuru.bio && !basvuru.intro_video_url;

  return (
    <td colSpan={6} className="bg-slate-50/70 px-4 py-4">
      {bosMu ? (
        <p className="text-sm text-slate-500">
          Aday isteğe bağlı bölümleri doldurmadı — bu bilgileri aramada sorabilirsiniz.
        </p>
      ) : (
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {satirlar.length > 0 && (
            <dl className="space-y-2 text-sm">
              {satirlar.map((s) => (
                <div key={s.etiket} className="flex gap-3">
                  <dt className="w-28 shrink-0 text-slate-500">{s.etiket}</dt>
                  <dd className="text-slate-800">{s.deger}</dd>
                </div>
              ))}
            </dl>
          )}
          {(basvuru.bio || basvuru.intro_video_url) && (
            <div className="space-y-3">
              {basvuru.bio && (
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                  {basvuru.bio}
                </p>
              )}
              {basvuru.intro_video_url && (
                <a
                  href={basvuru.intro_video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm font-medium text-panel-accent-text underline-offset-2 hover:underline"
                >
                  Tanıtım videosunu aç
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </td>
  );
}

const FILTRELER: { value: string | undefined; label: string }[] = [
  { value: "NEW", label: "Yeni" },
  { value: "CONTACTED", label: "Arandı" },
  { value: undefined, label: "Tümü" },
  { value: "CONVERTED", label: "Kazanıldı" },
  { value: "REJECTED", label: "Olumsuz" },
];

export default function AdminTutorApplicationsPage() {
  const { canView, canManage } = useAdminAreaAccess("tutors");
  // Operasyonel varsayılan: ekran "aranacaklar" listesi olarak açılır.
  const [filtre, setFiltre] = useState<string | undefined>("NEW");
  const [acikId, setAcikId] = useState<number | null>(null);

  const { data, isLoading, isError, refetch } =
    useAdminTutorPreApplications(filtre);
  const guncelle = useUpdateTutorPreApplicationStatus();

  if (!canView) return <AccessDenied area="Eğitmen ön başvuruları" />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Eğitmen ön başvuruları
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          /egitmen-on-basvuru sayfasından gelen kayıtlar. Hedef: yeni başvuruyu{" "}
          <span className="font-medium">24 saat içinde</span> aramak.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Filtre dili AdminPromotionsPage ile birebir aynı (pill deseni). */}
        {FILTRELER.map((f) => (
          <PlainButton
            key={f.label}
            onClick={() => setFiltre(f.value)}
            aria-pressed={filtre === f.value}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus ${
              filtre === f.value
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900"
            }`}
          >
            {f.label}
          </PlainButton>
        ))}
      </div>

      {isLoading ? (
        <PageSkeleton />
      ) : isError ? (
        <ErrorState
          description="Ön başvurular alınamadı."
          onRetry={() => void refetch()}
        />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Kayıt yok"
          description="Bu filtreye uyan bir ön başvuru bulunmuyor."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-3 pr-4">Başvuran</th>
                <th className="py-3 pr-4">Dersler</th>
                <th className="py-3 pr-4">İlçe / Deneyim</th>
                <th className="py-3 pr-4">Tarih</th>
                <th className="py-3 pr-4">Durum</th>
                <th className="py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((b: AdminTutorPreApplication) => (
                <Fragment key={b.id}>
                <tr className="align-top">
                  <td className="py-3 pr-4">
                    <div className="flex items-start gap-2.5">
                      {b.photo_url && (
                        <img
                          src={b.photo_url}
                          alt=""
                          className="mt-0.5 h-9 w-9 shrink-0 rounded-full object-cover"
                        />
                      )}
                      <div className="min-w-0">
                    <div className="font-medium text-slate-900">
                      {b.full_name}
                    </div>
                    <a
                      href={`tel:${b.phone}`}
                      className="font-medium text-panel-accent-text underline-offset-2 hover:underline"
                    >
                      {b.phone}
                    </a>
                    {b.email && (
                      <div>
                        <a
                          href={`mailto:${b.email}`}
                          className="text-xs text-panel-accent-text underline-offset-2 hover:underline"
                        >
                          {b.email}
                        </a>
                      </div>
                    )}
                    {(b.documents?.length ?? 0) > 0 && (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {b.documents!.map((doc, i) => (
                          <a
                            key={doc.url}
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={doc.name}
                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                          >
                            <span aria-hidden>📄</span> Belge {i + 1}
                          </a>
                        ))}
                      </div>
                    )}
                    {b.note && (
                      <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
                        {b.note}
                      </p>
                    )}
                      </div>
                    </div>
                  </td>
                  <td className="max-w-[18rem] py-3 pr-4 text-slate-600">
                    {/* Aday serbest metin yazar; kategori eşlemesini sunucu
                        yapar. Ham metni de gösteriyoruz: eşleşmenin neyden
                        geldiği görünmezse yanlış eşleşme fark edilmez. */}
                    <div className="flex flex-wrap gap-1">
                      {(b.matched_subjects ?? []).map((m) => (
                        <span
                          key={m.id}
                          title={`"${m.source_text}" → ${m.name}`}
                          className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800"
                        >
                          {m.name}
                        </span>
                      ))}
                      {(b.unmatched_subjects ?? []).map((u) => (
                        <span
                          key={u}
                          title="Katalogda karşılığı yok — eşanlamlı eklenebilir"
                          className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800"
                        >
                          {u} <span aria-hidden>·</span> eşleşmedi
                        </span>
                      ))}
                    </div>
                    {(b.matched_subjects?.length ?? 0) === 0 &&
                      (b.unmatched_subjects?.length ?? 0) === 0 && (
                        <span>{b.subjects}</span>
                      )}
                  </td>
                  <td className="py-3 pr-4 text-slate-600">
                    {b.district ?? "—"}
                    <div className="text-xs text-slate-400">
                      {b.experience
                        ? EXPERIENCE_LABELS[b.experience] ?? b.experience
                        : "Deneyim belirtilmedi"}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-slate-600">
                    {TR.format(new Date(b.created_at))}
                  </td>
                  <td className="py-3 pr-4">{durumRozeti(b.status)}</td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {canManage &&
                        sonrakiAdimlar(b.status).map((adim) => (
                          <Button
                            key={adim.to}
                            variant="ghost"
                            isPending={
                              guncelle.isPending &&
                              guncelle.variables?.id === b.id
                            }
                            onClick={() =>
                              guncelle.mutate({ id: b.id, status: adim.to })
                            }
                          >
                            {adim.label}
                          </Button>
                        ))}
                      <PlainButton
                        onClick={() => setAcikId(acikId === b.id ? null : b.id)}
                        aria-expanded={acikId === b.id}
                        aria-controls={`basvuru-detay-${b.id}`}
                        aria-label={`${b.full_name} başvurusunun ayrıntısı`}
                        className="rounded-lg px-2 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                      >
                        {acikId === b.id ? "Kapat" : "Detay"}
                      </PlainButton>
                    </div>
                  </td>
                </tr>
                {acikId === b.id && (
                  <tr id={`basvuru-detay-${b.id}`}>
                    <DetaySatiri basvuru={b} />
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
