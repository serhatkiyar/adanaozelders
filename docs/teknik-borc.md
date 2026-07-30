# Teknik Borç Defteri

Paket çalışmaları sırasında **fark edilen ama kapsam dışı olduğu için
dokunulmayan** sorunlar. Amaç: "sonra bakarız" demenin izini bırakmak. Her
kayıt bulunduğu yeri, gerçek etkisini ve neden ertelendiğini söyler.

Bir borcu kapatan commit, ilgili satırı **buradan siler** (kapatılmış borcun
notunu bırakmak, yapılmış bir işi yapılmamış gibi anlatır).

---

## TB-1 · `order_returns.reason` model ↔ şema varsayılan sapması

| | |
|---|---|
| **Bulundu** | Stok hareket defteri paketi, commit 4 (test tohumu yazılırken) |
| **Yer** | `backend/models/store.py::OrderReturn.reason` ↔ `order_returns.reason` kolonu |
| **Durum** | Modelde `server_default=text("''")` var; **veritabanı kolonunda varsayılan YOK** (`column_default IS NULL`, `is_nullable = 'NO'`) |
| **Etki** | Çalışma zamanında **yok**: uygulama yolu iade talebini her zaman `reason` ile oluşturuyor (müşteri gerekçeyi yazıyor, cayma hakkında boş dizgi geçiliyor). Sapma yalnız **ham SQL** ile satır ekleyen yerlerde patlar — bugün tek örneği test tohumları |
| **Risk** | Düşük ama sinsi: modele bakarak "varsayılanı var" varsayan bir migration/script `NotNullViolation` alır ve sebebi modelde görünmez |
| **Neden ertelendi** | Stoğa dokunmuyor. Düzeltmesi bir migration gerektiriyor (`ALTER COLUMN … SET DEFAULT ''`) ve o migration'ı stok paketinin revizyonuna karıştırmak, iki bağımsız değişikliği tek geri alma birimine bağlardı |
| **Önerilen çözüm** | Ayrı bir küçük migration: `ALTER TABLE order_returns ALTER COLUMN reason SET DEFAULT ''`. Alternatif olarak modeldeki `server_default` kaldırılıp gerçeğe uydurulabilir — ama o zaman `reason` gerçekten zorunlu bir iş alanı hâline gelir ve **cayma** yolunda gerekçe zorunlu olmadığı için (`Mesafeli Sözleşmeler` m.15 koşulsuz cayma) tercih edilen yön **DB'ye varsayılan eklemektir** |
| **Doğrulama** | `SELECT column_default FROM information_schema.columns WHERE table_name='order_returns' AND column_name='reason'` → bugün `NULL` |

**Not:** aynı sınıftan başka sapma olup olmadığı taranmadı. Bu borç kapatılırken
`server_default` tanımlı olup DB'de karşılığı bulunmayan **tüm** kolonlar için
tek seferlik bir denetim yazılması önerilir (baseline migration squash'ından
kalmış başka örnekler olabilir).
