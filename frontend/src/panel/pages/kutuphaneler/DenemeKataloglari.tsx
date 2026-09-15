import { useRef } from "react";
import { Button, Flex, Tag, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ConfirmDialog } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import {
  CatalogEditorPenceresi,
  emptyForm,
  toForm,
  type FormState,
} from "@/pages/dashboards/AdminExamCatalogs";
import {
  useCatalogs,
  useDeleteCatalog,
  useUploadCatalogAnswerKey,
} from "@/hooks/useExamCatalogs";
import { getErrorMessage } from "@/lib/errors";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { toast } from "@/store/toastStore";
import type { CatalogOut } from "@/types";

const SAR: React.CSSProperties = { overflowWrap: "anywhere" };

function KatalogSatiri({
  katalog,
  duzenle,
  son,
}: {
  katalog: CatalogOut;
  duzenle: () => void;
  son: boolean;
}) {
  const { token } = theme.useToken();
  const silme = useDuzenlemeYuzeyi<CatalogOut, void>();
  const sil = useDeleteCatalog();
  const cevapAnahtari = useUploadCatalogAnswerKey();
  const dosya = useRef<HTMLInputElement>(null);

  const silGonder = () => {
    sil.mutate(katalog.id, {
      onSuccess: () => {
        toast.success("Katalog silindi.");
        silme.kapat();
      },
      onError: (hata) => toast.error(getErrorMessage(hata, "Silinemedi.")),
    });
  };

  const cevapAnahtariYukle = (file: File) => {
    cevapAnahtari.mutate(
      { id: katalog.id, file },
      {
        onSuccess: () => toast.success("Cevap anahtarı yüklendi."),
        onError: (hata) =>
          toast.error(getErrorMessage(hata, "Yükleme başarısız.")),
      },
    );
  };

  return (
    <>
      <Flex
        data-testid={`katalog-${katalog.id}`}
        align="center"
        justify="space-between"
        gap={12}
        wrap
        style={{
          padding: "12px 0",
          borderBottom: son ? "none" : `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <Flex align="center" gap={8} wrap>
            <Tag style={{ marginInlineEnd: 0 }}>{katalog.exam_type}</Tag>
            {katalog.is_nationwide ? (
              <Tag color="warning" style={{ marginInlineEnd: 0 }}>
                Türkiye Geneli
              </Tag>
            ) : null}
            {!katalog.is_public ? (
              <Tag style={{ marginInlineEnd: 0 }}>Gizli</Tag>
            ) : null}
          </Flex>
          <Typography.Text strong style={{ display: "block", marginTop: 6, ...SAR }}>
            {katalog.exam_name}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            style={{ display: "block", marginTop: 2, fontSize: 12, ...SAR }}
          >
            {katalog.publisher_name || "Yayıncı belirtilmemiş"}
            {katalog.question_count ? ` · ${katalog.question_count} soru` : ""}
            {katalog.duration_minutes ? ` · ${katalog.duration_minutes} dk` : ""}
            {` · ${katalog.session_count} oturum`}
          </Typography.Text>
        </div>

        <Flex gap={8} wrap align="center">
          {katalog.answer_key_url ? (
            <Button
              href={katalog.answer_key_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Cevap anahtarı ✓
            </Button>
          ) : null}
          <Button
            loading={cevapAnahtari.isPending}
            onClick={() => dosya.current?.click()}
          >
            {katalog.answer_key_url ? "Değiştir" : "Cevap Anahtarı"}
          </Button>
          <input
            ref={dosya}
            type="file"
            accept="application/pdf,image/*"
            hidden
            onChange={(olay) => {
              const secilen = olay.target.files?.[0];
              if (secilen) cevapAnahtariYukle(secilen);
              olay.target.value = "";
            }}
          />
          <Button onClick={duzenle}>Düzenle</Button>
          <Button danger onClick={() => silme.ac(katalog)}>
            Sil
          </Button>
        </Flex>
      </Flex>

      <ConfirmDialog
        open={silme.acik}
        title="Deneme kataloğunu sil"
        description={`“${katalog.exam_name}” kataloğu silinecek.`}
        confirmLabel="Kataloğu sil"
        danger
        isPending={sil.isPending}
        onClose={silme.kapat}
        onConfirm={silGonder}
      />
    </>
  );
}

/** Eski katalog CRUD ve cevap anahtarı akışını yeni panel kabuğunda sunar. */
export function DenemeKataloglari() {
  const { token } = theme.useToken();
  const { canView, canManage } = useAdminAreaAccess("catalogs");
  const sorgu = useCatalogs(canView);
  const editor = useDuzenlemeYuzeyi<FormState, void>();
  const kataloglar = Array.isArray(sorgu.data) ? sorgu.data : [];

  if (!canView) return <AccessDenied area="Deneme katalogları" />;

  const govde = sorgu.isPending ? (
    <YukleniyorDurumu etiket="Deneme katalogları yükleniyor…" />
  ) : sorgu.isError ? (
    <HataDurumu
      hata="Katalog listesi yüklenemedi. Listenin boş olduğu anlamına gelmez."
      hataAksiyon={
        <Button size="small" onClick={() => void sorgu.refetch()}>
          Tekrar dene
        </Button>
      }
    />
  ) : kataloglar.length === 0 ? (
    <BosDurumu
      baslik="Henüz katalog eklenmedi"
      aciklama="İlk ortak denemeyi oluşturun."
      aksiyon={
        canManage ? (
          <Button type="primary" onClick={() => editor.ac(emptyForm())}>
            Katalog ekle
          </Button>
        ) : undefined
      }
    />
  ) : (
    kataloglar.map((katalog, index) =>
      canManage ? (
        <KatalogSatiri
          key={katalog.id}
          katalog={katalog}
          son={index === kataloglar.length - 1}
          duzenle={() => editor.ac(toForm(katalog))}
        />
      ) : (
        <Flex
          key={katalog.id}
          data-testid={`katalog-${katalog.id}`}
          vertical
          gap={4}
          style={{
            padding: "12px 0",
            borderBottom:
              index === kataloglar.length - 1
                ? "none"
                : `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Flex gap={8} wrap>
            <Tag style={{ marginInlineEnd: 0 }}>{katalog.exam_type}</Tag>
            {katalog.is_nationwide ? (
              <Tag color="warning" style={{ marginInlineEnd: 0 }}>
                Türkiye Geneli
              </Tag>
            ) : null}
            {!katalog.is_public ? <Tag style={{ marginInlineEnd: 0 }}>Gizli</Tag> : null}
          </Flex>
          <Typography.Text strong style={SAR}>{katalog.exam_name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, ...SAR }}>
            {katalog.publisher_name || "Yayıncı belirtilmemiş"}
            {` · ${katalog.session_count} oturum`}
          </Typography.Text>
          {katalog.answer_key_url ? (
            <Typography.Link
              href={katalog.answer_key_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Cevap anahtarını görüntüle
            </Typography.Link>
          ) : null}
        </Flex>
      ),
    )
  );

  return (
    <Flex vertical gap={16}>
      <Flex
        align="center"
        justify="space-between"
        gap={12}
        wrap
        style={{ minHeight: 40 }}
      >
        <div style={{ minWidth: 0 }}>
          <Typography.Title
            level={3}
            style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}
          >
            Deneme Katalogları
          </Typography.Title>
          <Typography.Text type="secondary">
            Kütüphanelerin oturum açarken kullandığı ortak deneme içerikleri ve cevap
            anahtarları.
          </Typography.Text>
        </div>
        {canManage && kataloglar.length > 0 ? (
          <Button type="primary" onClick={() => editor.ac(emptyForm())}>
            Katalog ekle
          </Button>
        ) : null}
      </Flex>

      {!canManage ? (
        <Typography.Text type="secondary">
          Salt okunur görünüm: katalog işlemleri için catalogs.manage izni gerekir.
        </Typography.Text>
      ) : null}

      <section
        aria-label="Deneme katalogları listesi"
        style={{
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 4,
        }}
      >
        <Flex
          align="center"
          justify="space-between"
          gap={12}
          wrap
          style={{ padding: "16px 24px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}
        >
          <div>
            <Typography.Text style={{ display: "block", fontSize: 18, fontWeight: 500 }}>
              Ortak kataloglar
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {kataloglar.length} katalog
            </Typography.Text>
          </div>
        </Flex>
        <div
          style={{
            padding:
              sorgu.isPending || sorgu.isError || kataloglar.length === 0
                ? "24px"
                : "0 24px",
          }}
        >
          {govde}
        </div>
      </section>

      <CatalogEditorPenceresi yuzey={editor} />
    </Flex>
  );
}
