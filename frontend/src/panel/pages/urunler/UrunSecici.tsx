import { useState } from "react";
import { Select } from "antd";
import { useAdminProducts } from "@/hooks/useStore";
import { useDebounce } from "@/hooks/useDebounce";

// Ürün adayları yalnız arama yazılınca çekilir (eski ProductPicker ile aynı). Yeni sayım çekmecesi ve sayım detayı kullanır; `value`/`onChange` Form.Item ile uyumlu.
export function UrunSecici({ value, onChange }: { value?: number[]; onChange?: (v: number[]) => void }) {
  const [arama, setArama] = useState("");
  const gecikmis = useDebounce(arama);
  const urunler = useAdminProducts({ q: gecikmis, limit: 20 }, gecikmis.length > 0);
  return (
    <Select
      mode="multiple"
      showSearch
      filterOption={false}
      aria-label="Ürünler"
      placeholder="Başlık, yazar, yayınevi, ISBN veya SKU"
      searchValue={arama}
      onSearch={setArama}
      loading={urunler.isFetching}
      notFoundContent={gecikmis ? "Eşleşen ürün yok" : "Aramak için yazın"}
      options={(urunler.data?.items ?? []).map((u) => ({ value: u.id, label: u.title }))}
      optionLabelProp="label"
      value={value}
      onChange={onChange}
      style={{ width: "100%" }}
    />
  );
}

