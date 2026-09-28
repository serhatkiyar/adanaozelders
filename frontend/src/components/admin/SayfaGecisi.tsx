import { Button, EmptyState } from "@/components/admin/ui";

/**
 * Toplam sayı DÖNDÜRMEYEN `limit`/`offset` uçları için sayfa geçişi.
 *
 * Bu listeler eskiden ucun varsayılan `limit=100` değeriyle çağrılıyor ve
 * 100. kayıttan sonrası sessizce kayboluyordu. Uç toplam vermediği için
 * "N kayıt" uydurulmaz; bunun yerine sayfa boyutundan BİR fazla satır
 * istenir: fazladan satır geldiyse daha eski kayıt vardır (kesin sinyal),
 * gelmediyse bu son sayfadır. Fazla satır ekrana basılmaz.
 */
export const SAYFA_BOYUTU = 50;

/** Uca gönderilecek `limit`: sayfa boyutu + 1 yoklama satırı. */
export const SAYFA_ISTEK_LIMITI = SAYFA_BOYUTU + 1;

export function sayfaOfseti(sayfa: number): number {
  return (sayfa - 1) * SAYFA_BOYUTU;
}

export function sayfaDilimi<T>(veri: readonly T[] | undefined): {
  satirlar: T[];
  dahaFazlaVar: boolean;
} {
  const liste = veri ?? [];
  return {
    satirlar: liste.slice(0, SAYFA_BOYUTU),
    dahaFazlaVar: liste.length > SAYFA_BOYUTU,
  };
}

interface SayfaGecisiProps {
  sayfa: number;
  dahaFazlaVar: boolean;
  onSayfaDegis: (sayfa: number) => void;
}

/** Tek sayfaya sığan listede hiçbir şey çizmez. */
export function SayfaGecisi({ sayfa, dahaFazlaVar, onSayfaDegis }: SayfaGecisiProps) {
  if (sayfa <= 1 && !dahaFazlaVar) return null;
  return (
    <div className="flex items-center justify-between text-xs text-slate-500">
      <span>
        {sayfa}. sayfa
        {dahaFazlaVar && " · daha eski kayıtlar var"}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={sayfa <= 1}
          onClick={() => onSayfaDegis(sayfa - 1)}
        >
          Önceki
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!dahaFazlaVar}
          onClick={() => onSayfaDegis(sayfa + 1)}
        >
          Sonraki
        </Button>
      </div>
    </div>
  );
}

/**
 * 2. ve sonraki sayfalar boş geldiğinde gösterilir (ör. filtreden düşen son
 * satır iptal edildi). "Hiç kayıt yok" demek YANLIŞ olurdu: önceki sayfalarda
 * kayıt vardır.
 */
export function BosSayfa({ onOnceki }: { onOnceki: () => void }) {
  return (
    <EmptyState
      title="Bu sayfada kayıt kalmadı"
      description="Daha yeni kayıtlar önceki sayfalarda."
      action={
        <Button size="sm" variant="secondary" onClick={onOnceki}>
          ← Önceki sayfaya dön
        </Button>
      }
    />
  );
}
