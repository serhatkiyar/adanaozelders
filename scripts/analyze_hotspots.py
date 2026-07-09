import pandas as pd

# CSV dosyasını oku
df = pd.read_csv('out/adana_venues_all.csv')

# İlçe bazında sayıları bulalım
ilce_dagilimi = df['ilce'].value_counts()

# Mahalle bazında sayıları bulalım (İlçe - Mahalle)
df['ilce_mahalle'] = df['ilce'] + ' - ' + df['mahalle']
mahalle_dagilimi = df['ilce_mahalle'].value_counts().head(15)

print("=== İLÇE BAZINDA TESLİMAT (ARZ) NOKTALARI ===")
print(ilce_dagilimi.to_string())
print("\n=== EN YOĞUN 15 MAHALLE (TESLİMAT SICAK NOKTALARI) ===")
print(mahalle_dagilimi.to_string())

# Aynı zamanda kütüphane/bilgi evi ile eğitim kurumlarını ayıralım
kategori_dagilimi = df['alt_klasor'].value_counts()
print("\n=== MEKAN TÜRLERİ ===")
print(kategori_dagilimi.to_string())
