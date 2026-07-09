import pandas as pd

# Veriyi oku
df = pd.read_csv('out/adana_venues_all.csv')

# İstenmeyen kategorileri (Sürücü Kursları ve muhtemelen Rehabilitasyon Merkezleri) filtrele
# YKS/KPSS için Eğitim Kurumları, Kütüphaneler, Bilgi Evleri ve Çalışma Kafeleri çok daha uygun.
istenmeyen_kelimeler = ['sürücü', 'rehabilatasyon', 'rehabilitasyon']

# alt_klasor veya kategori sütununda bu kelimeleri barındırmayanları seç
df_hedef = df[~df['alt_klasor'].str.lower().str.contains('|'.join(istenmeyen_kelimeler), na=False)]
df_hedef = df_hedef[~df_hedef['kategori'].str.lower().str.contains('|'.join(istenmeyen_kelimeler), na=False)]

# Yeni veriyi kaydet
df_hedef.to_csv('out/adana_hedef_noktalar.csv', index=False)

# Yeni istatistikleri yazdır
print(f"Eski Toplam Mekan Sayısı: {len(df)}")
print(f"Yeni Hedef Mekan Sayısı: {len(df_hedef)}")
print("\n=== YENİ HEDEF KİTLE DAĞILIMI ===")
print(df_hedef['alt_klasor'].value_counts().to_string())

print("\n=== YENİ EN YOĞUN 10 MAHALLE ===")
df_hedef['ilce_mahalle'] = df_hedef['ilce'] + ' - ' + df_hedef['mahalle']
print(df_hedef['ilce_mahalle'].value_counts().head(10).to_string())
