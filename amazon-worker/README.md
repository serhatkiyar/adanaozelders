# Amazon SP-API Worker & Katalog Analiz Araçları

Tedarikçi kataloglarının Amazon Türkiye (A33AVAJ2PDY3EV) pazaryeri üzerindeki ASIN eşleşmelerini, BuyBox / rekabetçi fiyatlarını, FBA/MFN komisyon kesintilerini ve net kârlılık marjlarını analiz eden bağımsız işçi servisi.

## Kurulum ve Çalıştırma

1. .env.example dosyasını .env olarak kopyalayın ve SP-API LWA kimlik bilgilerinizi girin:
   ```bash
   cp .env.example .env
   ```
2. Bağlantıyı doğrulayın:
   ```bash
   python test_connection.py
   ```
3. Konteyner olarak çalıştırmak için:
   ```bash
   docker compose up --build -d
   ```