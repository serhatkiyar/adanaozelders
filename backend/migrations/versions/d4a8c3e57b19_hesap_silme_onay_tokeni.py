"""token_purpose enum'una ACCOUNT_DELETE degeri

Parolasiz (Google ile acilmis) hesabin silme onayi icin. Parolali hesapta
onay parola ile veriliyor; parolasi olmayan hesabin o yolu yok ve KVKK silme
hakki kapali birakilamaz, o yuzden onay e-postaya gonderilen tek kullanimlik
bir baglantiyla veriliyor.

## Bu migration NEDEN ELLE YAZILDI

`alembic revision --autogenerate` bu degisikligi GORMEDI ve `alembic check`
"No new upgrade operations detected" dedi -- oysa kod ACCOUNT_DELETE
uretiyordu ve veritabani tipinde o deger YOKTU. Olculdu:

    SELECT enumlabel FROM pg_enum ... WHERE typname='token_purpose'
    -> EMAIL_VERIFY, PASSWORD_RESET          (veritabani)
    -> EMAIL_VERIFY, PASSWORD_RESET, ACCOUNT_DELETE   (kod)

Yani migration yazilmasaydi kapi CI'da yesil gecer, hata ancak bir kullanici
hesabini silmeye calistiginda ve InvalidTextRepresentation ile CANLIDA
gorunurdu. backend/CLAUDE.md bunu zaten uyariyor: enum degisikliklerinde
autogenerate ciktisinin eksik oldugunu peshinen varsayma, DOGRULA.

## Downgrade neden bos

PostgreSQL bir enum degerini KALDIRAMAZ (`ALTER TYPE ... DROP VALUE` yok).
Tipi yeniden yaratmak, ona bagli tum kolonlari yeniden yazmak demek olurdu ve
tasidigi risk kazanilan sadelikten buyuk. Fazladan bir enum degeri zararsizdir:
onu ureten kod geri alindiginda deger yalnizca kullanilmaz kalir.
"""

from alembic import op

revision = "d4a8c3e57b19"
down_revision = "f61f1415c6ad"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: ayni damgayi tasiyan ama degeri elle eklenmis bir
    # veritabaninda migration patlamasin.
    op.execute("ALTER TYPE token_purpose ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETE'")


def downgrade() -> None:
    """Bilincli olarak BOS -- gerekcesi dosya basligindadir."""
