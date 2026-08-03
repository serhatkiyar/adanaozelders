"""F30 baskı kabulü: PDF ölçüsü, metin bütünlüğü ve QR çözümü.

Bu betik `frontend/scripts/f30_browser_acceptance.mjs`'in ürettiği **gerçek
Chrome baskı çıktısını** denetler. JSDOM testi bunların hiçbirini göremez:

* `@media print` kuralı yanlışsa sayfa **boş** basılır (F26'da 1 KB'lık boş PDF
  üretildi ve kimse fark etmedi) — burada sayfa sayısı ve metin uzunluğu ölçülür.
* QR bir flex öğesidir; `shrink-0` yoksa uzun başlıklı kardeşi kareyi **yatay
  olarak ezer** (ölçüldü: 96 px → 36 px, yükseklik 96 kalıyor). Ezilmiş kare
  jsdom'da hâlâ "var" görünür ama **çözülemez** — burada gerçekten çözülür.
* Depo yazıcısı etiketi küçültebilir; %85 ölçekte de çözülmesi hata toleransı
  (`level="M"`) sözleşmesinin kanıtıdır.
* Adres `truncate`/`line-clamp` ile kırpılmışsa metin çıkarımında **eksik**
  görünür — kâğıttan okunamayan adres kuryeyi yanlış kapıya gönderir.

Çıktı: tek satır JSON. Başarısızlıkta çıkış kodu 1.

Kullanım:
    python -m scripts.f30_baski_kabul <pdf> --qr <beklenen-payload> \
        --icermeli "PKT-000042" --icermeli "Reşatbey Mahallesi ..."
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

import cv2
import fitz  # PyMuPDF
import numpy as np

#: Taban tarama çözünürlüğü. 72 dpi PDF birimidir; 300 dpi ofis yazıcısının
#: gerçek çıktı çözünürlüğüne yakındır ve QR modülleri bu ölçekte ayrışır.
TABAN_DPI = 300

#: "%15 küçültülmüş etiket" kabulü — sözleşmedeki ikinci çözme denemesi.
KUCUK_ORAN = 0.85


def _sayfa_goruntusu(sayfa: fitz.Page, dpi: float) -> np.ndarray:
    zoom = dpi / 72.0
    pix = sayfa.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)


def _qr_coz(img: np.ndarray, dpi: float) -> list[dict]:
    """Görüntüdeki QR'ları çözer **ve geometrisini ölçer**.

    ## Neden çözmek YETMİYOR (ölçülen ters prova)

    Kare 112 px'ten 36 px'e yatay olarak ezildiğinde (F26'da gerçekten yaşanan
    bozulma) OpenCV **yine de çözüyor**: dedektör bulduğu dörtgene perspektif
    düzeltmesi uygular, yani anizotropik ölçeğe toleranslı. Bu betiğin ilk
    hâli tam da bu yüzden ezik kareyi "geçti" sayıyordu ve yalnız yan bir
    koşul (metin uzunluğu) sayesinde kırmızıya döndü — yani yanlış sebeple.

    Telefon kamerası bu kadar hoşgörülü değildir: elde tutulan, eğik ve
    bulanık bir karede ezilmiş modüller okunmaz. Bu yüzden çözümün yanında
    **en/boy oranı** ve **fiziksel kenar uzunluğu** ölçülür; ikisi de
    sözleşmenin parçasıdır.
    """
    dedektor = cv2.QRCodeDetector()
    bulunan: list[tuple[str, np.ndarray | None]] = []
    ok, kodlar, noktalar, _ = dedektor.detectAndDecodeMulti(img)
    if ok and kodlar:
        for i, k in enumerate(kodlar):
            if k:
                bulunan.append((k, noktalar[i] if noktalar is not None else None))
    if not bulunan:
        # Tekil dedektör bazı gri tonlamalı taramalarda çoklu dedektörden daha
        # başarılı; ikisi de denenmeden "çözülemedi" denmez.
        tek, pts2 = dedektor.detect(img)
        if tek:
            veri = dedektor.decode(img, pts2)
            if isinstance(veri, tuple):
                veri = veri[0]
            if veri:
                bulunan.append((veri, pts2[0] if pts2 is not None else None))

    sonuc = []
    for yuk, quad in bulunan:
        olcu = {"yuk": yuk, "genislik_mm": None, "yukseklik_mm": None, "en_boy": None}
        if quad is not None and len(quad) == 4:
            q = np.array(quad, dtype=float).reshape(4, 2)
            gen_px = (
                np.linalg.norm(q[0] - q[1]) + np.linalg.norm(q[3] - q[2])
            ) / 2.0
            yuk_px = (
                np.linalg.norm(q[0] - q[3]) + np.linalg.norm(q[1] - q[2])
            ) / 2.0
            mm = 25.4 / dpi
            olcu["genislik_mm"] = round(gen_px * mm, 2)
            olcu["yukseklik_mm"] = round(yuk_px * mm, 2)
            olcu["en_boy"] = round(gen_px / yuk_px, 3) if yuk_px else None
        sonuc.append(olcu)
    return sonuc


def ana() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=pathlib.Path)
    ap.add_argument("--qr", action="append", default=[], help="beklenen QR yükü (tekrarlanabilir)")
    ap.add_argument("--icermeli", action="append", default=[], help="metinde bulunmalı")
    ap.add_argument("--icermemeli", action="append", default=[], help="metinde BULUNMAMALI")
    ap.add_argument("--min-sayfa", type=int, default=1)
    # Kâğıttaki kare en az bu kadar olmalı. 15 mm, elde tutulan bir telefonun
    # ~10 cm'den okuyabildiği alt sınırdır; `PackageLabel`'ın 112 px'lik ölçüsü
    # 96 dpi'da ~29,6 mm eder, yani tavan değil taban denetlenir. 96 px'e
    # düşürme mutasyonu (~25,4 mm) bu eşiği GEÇER — eşik "yanlışlıkla küçüldü"
    # değil "okunamayacak kadar küçüldü" hâlini yakalar.
    ap.add_argument("--min-kenar-mm", type=float, default=15.0)
    # Ezilmiş kare toleransı. Kare olmayan bir QR'ı OpenCV perspektif
    # düzeltmesiyle yine çözer; telefon kamerası çözmez (ölçüldü).
    ap.add_argument("--en-boy-tolerans", type=float, default=0.10)
    args = ap.parse_args()

    if not args.pdf.exists():
        print(json.dumps({"ok": False, "hata": f"PDF yok: {args.pdf}"}, ensure_ascii=False))
        return 1

    boyut = args.pdf.stat().st_size
    belge = fitz.open(args.pdf)
    sayfalar = belge.page_count
    metin = "\n".join(belge[i].get_text() for i in range(sayfalar))

    normal: list[dict] = []
    kucuk: list[dict] = []
    olculer = []
    for i in range(sayfalar):
        sayfa = belge[i]
        olculer.append(
            {"sayfa": i + 1, "genislik_pt": round(sayfa.rect.width, 1), "yukseklik_pt": round(sayfa.rect.height, 1)}
        )
        normal += _qr_coz(_sayfa_goruntusu(sayfa, TABAN_DPI), TABAN_DPI)
        kucuk += _qr_coz(_sayfa_goruntusu(sayfa, TABAN_DPI * KUCUK_ORAN), TABAN_DPI * KUCUK_ORAN)
    belge.close()

    normal_yukler = [o["yuk"] for o in normal]
    kucuk_yukler = [o["yuk"] for o in kucuk]

    # Geometri YALNIZ normal ölçekte denetlenir: %85'lik ikinci tarama, kâğıdın
    # küçültülerek basılmasını taklit eder ve orada kenarın küçülmesi beklenen
    # sonuçtur — orada da eşik aramak, kabulün kendi senaryosunu reddetmesi olurdu.
    ezik = [
        o
        for o in normal
        if o["en_boy"] is not None and abs(o["en_boy"] - 1.0) > args.en_boy_tolerans
    ]
    kucuk_kare = [
        o
        for o in normal
        if o["genislik_mm"] is not None
        and min(o["genislik_mm"], o["yukseklik_mm"]) < args.min_kenar_mm
    ]
    olculemeyen = [o for o in normal if o["en_boy"] is None]

    eksik_metin = [s for s in args.icermeli if s not in metin]
    fazla_metin = [s for s in args.icermemeli if s in metin]
    eksik_qr_normal = [q for q in args.qr if q not in normal_yukler]
    eksik_qr_kucuk = [q for q in args.qr if q not in kucuk_yukler]

    sonuc = {
        "ok": not (
            eksik_metin
            or fazla_metin
            or eksik_qr_normal
            or eksik_qr_kucuk
            or ezik
            or kucuk_kare
            or olculemeyen
            or sayfalar < args.min_sayfa
            or boyut < 2048
            or len(metin.strip()) < 20
        ),
        "pdf": str(args.pdf),
        "bayt": boyut,
        "sayfa_sayisi": sayfalar,
        "sayfa_olculeri": olculer,
        "metin_uzunlugu": len(metin.strip()),
        "qr_normal": sorted(set(normal_yukler)),
        "qr_kucultulmus_%d%%" % round(KUCUK_ORAN * 100): sorted(set(kucuk_yukler)),
        "qr_geometrisi": normal,
        "eksik_qr_normal": eksik_qr_normal,
        "eksik_qr_kucultulmus": eksik_qr_kucuk,
        "ezik_kare": ezik,
        "kucuk_kare": kucuk_kare,
        "olculemeyen_kare": olculemeyen,
        "eksik_metin": eksik_metin,
        "olmamasi_gereken_metin": fazla_metin,
    }
    print(json.dumps(sonuc, ensure_ascii=False))
    return 0 if sonuc["ok"] else 1


if __name__ == "__main__":
    sys.exit(ana())
