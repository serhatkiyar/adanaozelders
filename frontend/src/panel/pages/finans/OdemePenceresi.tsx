// Hak Edişler ekranının ödeme penceresi.
//
// Neden AYRI dosya: pencere ekranla aynı dosyada durduğunda açık/kapalı durumu ekranın
// `useState`inde yaşıyor ve `ui-baseline` nöbetçisinin "ekranda yaşayan pencere durumu"
// ölçümüne düşüyordu (TABAN 0). Panelin yerleşik çözümü pencereyi kendi dosyasına almak
// ve durumu PROP olarak geçirmektir — `SiparisDetayPencereleri.tsx`, `UrunAracCubugu.tsx`
// ve `OneCikarmaPenceresi.tsx` ile aynı desen. Davranış değişmedi.
import { useRef, useState } from "react";
import { Alert, Button, Drawer, Flex, Form, Input, InputNumber, Modal, Typography } from "antd";
import { useCreatePayout } from "@/hooks/usePayouts";
import { getErrorMessage } from "@/lib/errors";
import { formatTL, parseMoney } from "@/lib/money";
import { toast } from "@/store/toastStore";
import { odenebilirTutar, type PayeeBalance, type PayoutCreate } from "@/api/payouts";

type OdemeDegerleri = { amount: number; reference?: string; note?: string };

export function OdemePenceresi({ hedef, kapat }: { hedef: PayeeBalance | null; kapat: () => void }) {
  const [form] = Form.useForm<OdemeDegerleri>();
  const create = useCreatePayout();
  const kilit = useRef(false);
  const [hata, setHata] = useState<string | null>(null);
  const mesgul = kilit.current || create.isPending;
  // Öğretmende üst sınır talep tutarıdır (bkz. `odenebilirTutar`).
  const odenebilir = hedef ? odenebilirTutar(hedef) : "0";
  const max = parseMoney(odenebilir) ?? 0;

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
          <Form.Item name="amount" label="Tutar (TL)" rules={[{ required: true, message: "Tutar gerekli." }, { type: "number", min: 0.01, message: "Tutar sıfırdan büyük olmalı." }, { validator: (_, value) => Number(value) <= max ? Promise.resolve() : Promise.reject(new Error(`Tutar en fazla ${formatTL(odenebilir)} olabilir.`)) }]}>
            <InputNumber min={0.01} step={0.01} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="reference" label="Havale referansı" rules={[{ max: 120, message: "Referans en fazla 120 karakter olabilir." }]}><Input maxLength={120} placeholder="Dekonttaki referans no" /></Form.Item>
          <Form.Item name="note" label="Not" rules={[{ max: 1000, message: "Not en fazla 1000 karakter olabilir." }]}><Input.TextArea rows={3} maxLength={1000} showCount /></Form.Item>
        </Form>
      ) : null}
    </Drawer>
  );
}
