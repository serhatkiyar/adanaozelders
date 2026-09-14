import { useRef, useState } from "react";
import { Alert, Button, Drawer, Flex, Form, Input, InputNumber, Modal, Segmented, Table, Tag, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { useCreatePayout, usePayoutHistory, usePendingPayouts } from "@/hooks/usePayouts";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import { formatDate } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { formatTL, parseMoney } from "@/lib/money";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { toast } from "@/store/toastStore";
import type { PayeeBalance, PayoutCreate } from "@/api/payouts";

type OdemeDegerleri = { amount: number; reference?: string; note?: string };

/** Elle yapılan havalelerin hak ediş defterini yeni panel kabuğunda yönetir. */
export function HakEdisler() {
  const { token } = theme.useToken();
  const { canView, canManage } = useAdminAreaAccess("payments");
  const url = useUrlDurumu({ sekme: "odenecekler" });
  const sekme = url.degerler.sekme === "gecmis" ? "gecmis" : "odenecekler";
  const bekleyenler = usePendingPayouts(true, canView && sekme === "odenecekler");
  const gecmis = usePayoutHistory(100, canView && sekme === "gecmis");
  const [hedef, setHedef] = useState<PayeeBalance | null>(null);
  const ayrac = token.colorBorderSecondary;

  if (!canView) return <AccessDenied area="Hak edişler" />;

  return (
    <Flex vertical gap={24}>
      <div>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>
          Hak Edişler
        </Typography.Title>
        <Typography.Text type="secondary">
          {canManage
            ? "Eğitmen ve kütüphanelere bankadan yapılan ödemeleri hak ediş defterine kaydedin."
            : "Salt okunur görünüm: ödeme kaydetmek için payments.manage izni gerekir."}
        </Typography.Text>
      </div>

      <Segmented
        aria-label="Hak ediş görünümü"
        block
        value={sekme}
        options={[
          { value: "odenecekler", label: "Ödenecekler" },
          { value: "gecmis", label: "Ödeme geçmişi" },
        ]}
        onChange={(value) => url.ayarla({ sekme: String(value) })}
      />

      <section style={{ background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 }}>
        <div style={{ padding: 24 }}>
          {sekme === "odenecekler" ? (
            <Bekleyenler sorgu={bekleyenler} canManage={canManage} onPay={setHedef} />
          ) : (
            <Gecmis sorgu={gecmis} />
          )}
        </div>
      </section>

      <OdemePenceresi hedef={hedef} kapat={() => setHedef(null)} />
    </Flex>
  );
}

function Bekleyenler({ sorgu, canManage, onPay }: {
  sorgu: ReturnType<typeof usePendingPayouts>;
  canManage: boolean;
  onPay: (kayit: PayeeBalance) => void;
}) {
  if (sorgu.isPending) return <YukleniyorDurumu etiket="Ödenecek hak edişler yükleniyor" />;
  if (sorgu.isError) {
    return <HataDurumu hata="Ödenecekler listesi alınamadı. Listenin boş olduğu anlamına gelmez." hataAksiyon={<Button onClick={() => void sorgu.refetch()}>Tekrar dene</Button>} />;
  }
  const liste = Array.isArray(sorgu.data) ? sorgu.data : [];
  if (liste.length === 0) return <BosDurumu baslik="Ödenmemiş hak ediş yok" aciklama="Yeni bir hak ediş oluştuğunda burada görünecek." />;
  const toplam = liste.reduce((sum, kayit) => sum + (parseMoney(kayit.balance) ?? 0), 0);

  return (
    <Flex vertical gap={12}>
      <Typography.Text type="secondary">
        Toplam ödenecek: <Typography.Text strong>{formatTL(toplam)}</Typography.Text> · {liste.length} alıcı
      </Typography.Text>
      <Table
        rowKey={(kayit) => `${kayit.payee_type}-${kayit.payee_id}`}
        dataSource={liste}
        pagination={false}
        scroll={{ x: 760 }}
        columns={[
          { title: "Alıcı", render: (_, kayit) => <Flex gap={8} align="center"><Typography.Text strong>{kayit.name}</Typography.Text><Tag>{kayit.payee_type === "TUTOR" ? "Eğitmen" : "Kütüphane"}</Tag></Flex> },
          { title: "IBAN", render: (_, kayit) => kayit.iban ? <Typography.Text style={{ fontFamily: "monospace" }}>{kayit.iban}</Typography.Text> : <Typography.Text type="warning">IBAN yok</Typography.Text> },
          { title: "Hak edilen", align: "right", render: (_, kayit) => formatTL(kayit.earned) },
          { title: "Ödenen", align: "right", render: (_, kayit) => formatTL(kayit.paid) },
          { title: "Bakiye", align: "right", render: (_, kayit) => <Typography.Text strong>{formatTL(kayit.balance)}</Typography.Text> },
          { title: "Emanette", align: "right", render: (_, kayit) => formatTL(kayit.pending) },
          ...(canManage ? [{ title: "", align: "right" as const, render: (_: unknown, kayit: PayeeBalance) => <Button onClick={() => onPay(kayit)}>Ödedim</Button> }] : []),
        ]}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        “Emanette” henüz hak edilmemiş tutardır; borç değildir ve iade edilebilir.
      </Typography.Text>
    </Flex>
  );
}

function Gecmis({ sorgu }: { sorgu: ReturnType<typeof usePayoutHistory> }) {
  if (sorgu.isPending) return <YukleniyorDurumu etiket="Ödeme geçmişi yükleniyor" />;
  if (sorgu.isError) return <HataDurumu hata={getErrorMessage(sorgu.error, "Ödeme geçmişi yüklenemedi.")} hataAksiyon={<Button onClick={() => void sorgu.refetch()}>Tekrar dene</Button>} />;
  const liste = Array.isArray(sorgu.data) ? sorgu.data : [];
  if (liste.length === 0) return <BosDurumu baslik="Henüz ödeme kaydı yok" aciklama="Kaydedilen banka ödemeleri burada listelenecek." />;
  return (
    <Table
      rowKey="id"
      dataSource={liste}
      pagination={false}
      scroll={{ x: 680 }}
      columns={[
        { title: "Tarih", dataIndex: "paid_at", render: (deger: string) => formatDate(deger) },
        { title: "Alıcı", render: (_, kayit) => `${kayit.payee_type === "TUTOR" ? "Eğitmen" : "Kütüphane"} #${kayit.payee_id}` },
        { title: "Tutar", align: "right", render: (_, kayit) => <Typography.Text strong>{formatTL(kayit.amount)}</Typography.Text> },
        { title: "Referans", dataIndex: "reference", render: (deger?: string | null) => deger || "-" },
        { title: "IBAN (o anki)", dataIndex: "iban_snapshot", render: (deger?: string | null) => <Typography.Text style={{ fontFamily: "monospace" }}>{deger || "-"}</Typography.Text> },
      ]}
    />
  );
}

function OdemePenceresi({ hedef, kapat }: { hedef: PayeeBalance | null; kapat: () => void }) {
  const [form] = Form.useForm<OdemeDegerleri>();
  const create = useCreatePayout();
  const kilit = useRef(false);
  const [hata, setHata] = useState<string | null>(null);
  const mesgul = kilit.current || create.isPending;
  const max = hedef ? (parseMoney(hedef.balance) ?? 0) : 0;

  const gercekKapat = () => {
    setHata(null);
    form.resetFields();
    kapat();
  };
  const kapatmaIstegi = () => {
    if (kilit.current || create.isPending) return;
    if (!form.isFieldsTouched()) return gercekKapat();
    Modal.confirm({
      title: "Kaydedilmemiş değişiklikler var",
      content: "Ödeme bilgileri kaydedilmeden kapatılacak.",
      okText: "Değişiklikleri sil",
      cancelText: "Düzenlemeye devam et",
      onOk: gercekKapat,
    });
  };
  const gonder = async (degerler: OdemeDegerleri) => {
    if (!hedef || kilit.current || create.isPending) return;
    kilit.current = true;
    setHata(null);
    const govde: PayoutCreate = {
      payee_type: hedef.payee_type,
      payee_id: hedef.payee_id,
      amount: String(degerler.amount),
      reference: degerler.reference?.trim() || null,
      note: degerler.note?.trim() || null,
    };
    try {
      await create.mutateAsync(govde);
      toast.success("Ödeme kaydedildi.");
      gercekKapat();
    } catch (error) {
      setHata(getErrorMessage(error, "Ödeme kaydedilemedi."));
    } finally {
      kilit.current = false;
    }
  };

  return (
    <Drawer
      open={hedef !== null}
      title={hedef ? `Ödeme kaydı: ${hedef.name}` : "Ödeme kaydı"}
      width={480}
      onClose={kapatmaIstegi}
      maskClosable={!mesgul}
      keyboard={!mesgul}
      footer={<Flex justify="flex-end" gap={8}><Button disabled={mesgul} onClick={kapatmaIstegi}>Vazgeç</Button><Button type="primary" loading={mesgul} onClick={() => form.submit()}>Ödemeyi kaydet</Button></Flex>}
    >
      {hedef ? (
        <Form form={form} layout="vertical" initialValues={{ amount: max, reference: "", note: "" }} onFinish={(degerler) => void gonder(degerler)}>
          <Flex vertical gap={12}>
            <Typography.Text type="secondary">Ödenmemiş bakiye: <Typography.Text strong>{formatTL(hedef.balance)}</Typography.Text></Typography.Text>
            {hedef.iban ? <Typography.Text code>{hedef.iban}</Typography.Text> : <Alert type="warning" showIcon message="Bu alıcının IBAN'ı kayıtlı değil; ödemeden önce kendisinden isteyin." />}
            {hata ? <Alert type="error" showIcon message={hata} /> : null}
          </Flex>
          <Form.Item name="amount" label="Tutar (TL)" rules={[{ required: true, message: "Tutar gerekli." }, { type: "number", min: 0.01, message: "Tutar sıfırdan büyük olmalı." }, { validator: (_, value) => Number(value) <= max ? Promise.resolve() : Promise.reject(new Error(`Tutar en fazla ${formatTL(hedef.balance)} olabilir.`)) }]}>
            <InputNumber min={0.01} step={0.01} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="reference" label="Havale referansı" rules={[{ max: 120, message: "Referans en fazla 120 karakter olabilir." }]}><Input maxLength={120} placeholder="Dekonttaki referans no" /></Form.Item>
          <Form.Item name="note" label="Not" rules={[{ max: 1000, message: "Not en fazla 1000 karakter olabilir." }]}><Input.TextArea rows={3} maxLength={1000} showCount /></Form.Item>
        </Form>
      ) : null}
    </Drawer>
  );
}
