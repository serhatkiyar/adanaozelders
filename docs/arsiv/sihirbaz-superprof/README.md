# İlan sihirbazı — Superprof düzenine geçişin ölçüm kanıtı

**Tarih:** 5 Eylül 2026 · **Araç:** `frontend/scripts/sihirbaz_mobil_turu.mjs`
(gerçek Chrome, CDP, headless)

## Koşum

```bash
cd frontend
node scripts/sihirbaz_mobil_turu.mjs \
  --frontend http://127.0.0.1:5177 \
  --api http://127.0.0.1:8000/api/v1 \
  --genislikler 360,414,1440 --out ./sihirbaz-son
```

## Sonuç

| | |
|---|---|
| Ölçülen kombinasyon | **27** (9 adım × 360/414/1440 px) |
| Yatay taşma | 0 |
| Fold altında kalan adım başlığı | 0 |
| Görünmeyen/kırpılan birincil düğme | 0 |
| 44px altı dokunma hedefi | 0 |
| Konsol hatası / sayfa istisnası | 0 |

## Negatif kontrol (kapılar gerçekten ölçüyor mu)

```bash
node scripts/sihirbaz_mobil_turu.mjs ... --negatif 1
```

Tüm dokunma hedefleri sentetik olarak küçültüldüğünde **27/27 kapı kırmızı**
döndü. Yeşil sonuç bu yüzden anlamlı: kapılar açık ve ölçüyor.

## Araçta bu turda değişenler

- `ADIM_SAYISI` 11 → 9 (müsaitlik ve belge adımları sihirbazdan çıktı).
- `--genislikler` ve `--ss` parametreleri eklendi (önceden 360/414 sabitti ve
  ekran görüntüsü adımları koda gömülüydü).
- "birincil düğme görünür alanda" kapısı **yalnız `< 640px`** için koşuyor:
  aksiyon çubuğu `sm` altında ekrana sabitlenir ve orada görünmemesi akışı
  keser; `sm` üstünde bilerek akışa döner ve uzun bir sayfada (Özet) aşağıda
  kalması normaldir. Kuralı masaüstünde de uygulamak olmayan bir kusuru
  raporluyordu.

## Görseller

- `baslik-1440.png` — masaüstü iki kolon: solda bilgi kartı, sağda dev başlık
- `ders-yeri-390.png` — mobil: soru üstte, yardım altta katlanmış, çubuk sabit
- `ozet-1440.png` — özet adımı (bilgi kartı yok → tek sütuna düşer)
