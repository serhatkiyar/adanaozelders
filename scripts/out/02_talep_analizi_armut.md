---
tags: [adana, rapor, talep]
guncelleme: 2026-06-20
kaynak: Armut.com Adana
---

# 📈 Adana Özel Ders — Talep Analizi (Armut)

Arz tarafını (mekân/kurum) `01 Adana Arz & Fırsat Raporu`'nda topladık.
Bu rapor **talep** tarafı: Adana'da hangi derse ne kadar talep var?
Kaynak: Armut.com Adana sayfaları (Türkiye'nin en büyük hizmet pazarı — gerçek müşteri/yorum verisi).

> [!warning] Veri uyarıları
> - **"Yılda X kişi"** çoğu düşük kategoride **30** tabanında takılıyor → bu bir alt-sınır/gürültü, gerçek 0 değil ama ayırt edici değil. Düşük hacimli dikeylerde **yorum sayısı** (birikmiş gerçekleşmiş iş) daha güvenilir sinyal.
> - **Eğitmen sayıları örtüşür** (matematik hocası LGS Fen'de de sayılır).
> - Rakamlar pazarlama amaçlı, **mutlak değil göreli** okunmalı.
> - Sahibinden DataDome bot koruması nedeniyle çekilemedi (elle bakılmalı).

## Ham veri (Adana)

| Dikey | Yıllık müşteri | Yorum (birikmiş) | Eğitmen | Fiyat (TL) |
|---|---|---|---|---|
| Genel özel ders | 798 | **1.348** | 127 | 250–10.500 |
| **İngilizce** | **1.611** | 384 | 155 | 400–3.600 |
| **Matematik** | **1.202** | 430 | 276 | 500–4.250 |
| İlkokul | 398 | 198 | 204 | 300–2.000 |
| Almanca | 347 | 157 | 78 | 500–3.200 |
| TYT | 30* | **453** | 62 | 500–2.500 |
| Ortaokul | 30* | 259 | 58 | 400–2.000 |
| Fizik | 157 | 83 | 165 | 700–2.500 |
| Kimya | 132 | 89 | 178 | 600–2.400 |
| Resim | 132 | 73 | 56 | 400–5.000 |
| Edebiyat/Türkçe | 30* | 92 | 71 | 500–2.000 |
| LGS Fen | 37 | 56 | 93 | 600–2.000 |
| KPSS | 30* | 33 | 77 | 500–1.500 |
| Biyoloji | 30* | 13 | 72 | 600–2.000 |
| YKS (genel etiket) | 30* | 10 | 52 | 600–1.700 |

`*` = 30 tabanı (düşük/güvenilmez hacim sinyali)

## Ana içgörü: insanlar "sınav" değil "ders" arıyor

"YKS özel ders" (10 yorum) ve "LGS Fen" (56) **düşük**, ama "Matematik" (430), "İngilizce" (384), "TYT" (453) **yüksek**. Yani öğrenci/veli arama yaparken **sınav etiketi değil, ders/dil adı** kullanıyor. Sınav hazırlığı talebi gerçek — ama **matematik, fizik, kimya, TYT** gibi konu etiketlerinden akıyor, soyut "YKS" kategorisinden değil.

→ **Beachhead sınav ekseninde değil, ders (subject) ekseninde kurulmalı.**

## Talebi gerçekleşmiş işe göre sırala (yorum = en güvenilir)

1. Genel 1.348 · 2. **TYT 453** · 3. **Matematik 430** · 4. **İngilizce 384**
5. Ortaokul 259 · 6. İlkokul 198 · 7. Almanca 157 · 8. Edebiyat 92
9. Kimya 89 · 10. Fizik 83 · 11. Resim 73 · 12. LGS Fen 56

İki bağımsız metrik (yıllık müşteri + yorum) **tutarlı şekilde** şunları öne çıkarıyor:
**Matematik, İngilizce, TYT, İlkokul/Ortaokul.**

## Beachhead önerisi

| Aday | Lehte | Aleyhte |
|---|---|---|
| **Matematik** | En yüksek arz (276), her iki metrikte güçlü, **LGS+YKS+TYT'nin belkemiği** | Tek başına "sınav" demek değil (artı de olabilir) |
| **İngilizce** | En yüksek yıllık talep (1.611), yetişkin dahil, **deadline'sız sürekli gelir** | Arz biraz dar (155) |
| **TYT** | 453 yorum = en yoğun gerçekleşmiş sınav talebi | Mevsimsel, dar yaş aralığı |
| İlkokul/Ortaokul | Geniş, veli öder, tekrar eden | Düşük fiyat, düşük LTV |

**Sonuç:** Beachhead = **Matematik + İngilizce** (iki konu birden).
- **Matematik** sınav köprüsüdür (LGS/TYT/AYT öğrencisi "matematik hocası" arar).
- **İngilizce** en geniş, deadline'sız, yetişkin dahil sürekli talebi getirir.
- İkisi birlikte hem "sınav hazırlık" hedefini hem "her şeye özel ders" vizyonunu kapsar; YKS'ye kilitlemez.

## Sıradaki doğrulama (elle)
- **Sahibinden**: `sahibinden.com/ozel-ders-okul-kurs/adana` → alt kategori ilan sayıları (bot engeli → tarayıcıdan bak).
- **Google Trends**: Adana bölgesi "matematik özel ders" vs "ingilizce özel ders" vs "lgs özel ders" arama trendi.
