import { useState } from "react";
import { Form, Input, Radio } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";

export type VaryantEkseni = { ad: string; degerler: string[] };

export function VaryantPenceresi({
  acik,
  kapat,
  eklendi,
}: {
  acik: boolean;
  kapat: () => void;
  eklendi: (eksen: VaryantEkseni) => void;
}) {
  const [ad, setAd] = useState("");
  const [degerler, setDegerler] = useState("");
  const [stil, setStil] = useState<"liste" | "renk">("liste");

  function kaydet() {
    const parcalar = degerler
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    if (!ad.trim() || parcalar.length === 0) return;
    eklendi({ ad: ad.trim(), degerler: parcalar });
    setAd("");
    setDegerler("");
    setStil("liste");
    kapat();
  }

  return (
    <YanPencere acik={acik} baslik="Varyant Ekle" kapat={kapat} kaydet={kaydet}>
      <Form layout="vertical">
        <Form.Item label="Varyant Türü Adı" required>
          <Input
            aria-label="Varyant Türü Adı"
            value={ad}
            onChange={(e) => setAd(e.target.value)}
            placeholder="ör. Renk, Ebat"
          />
        </Form.Item>
        <Form.Item label="Seçim Stili">
          <Radio.Group value={stil} onChange={(e) => setStil(e.target.value)}>
            <Radio value="liste">Liste</Radio>
            <Radio value="renk">Renk / Görsel</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item label="Varyantlar" required help="Virgülle ayırın: Kırmızı,Mavi">
          <Input
            aria-label="Varyantlar"
            value={degerler}
            onChange={(e) => setDegerler(e.target.value)}
            placeholder="Kırmızı,Mavi"
          />
        </Form.Item>
      </Form>
    </YanPencere>
  );
}
