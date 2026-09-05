"""Ürün açıklaması zengin metin oldu — XSS sınırının nöbeti.

Açıklama artık TipTap HTML'i taşıyabiliyor ve vitrinde
`dangerouslySetInnerHTML` ile basılıyor. Yüzey bloğunkinden GENİŞTİR: dijital
ürün açıklamasını EĞİTMEN de yazabiliyor (`create_seller_product`).

Bu dosya iki şeyi kilitler:

  1. Temizlik gerçekten yapılıyor (script/iframe/on*/javascript: geçmiyor).
  2. Açıklama yazan DÖRT yolun dördü de temizlikten geçiyor — biri unutulursa
     kalanların yeşil olması hiçbir şey ifade etmez.

İkincisi kaynak taramasıyla ölçülür: `setattr` döngüsü DİNAMİK bir yazım
yoludur ve oraya düşen bir alanı hiçbir davranış testi yakalayamaz.
"""
from __future__ import annotations

import re
from pathlib import Path

from services.store_service import _temiz_aciklama


class TestTemizlik:
    def test_script_etiketi_gecmez(self) -> None:
        assert "<script" not in (_temiz_aciklama("<script>alert(1)</script>") or "")

    def test_olay_oznitelikleri_gecmez(self) -> None:
        temiz = _temiz_aciklama('<p onclick="alert(1)">merhaba</p>') or ""
        assert "onclick" not in temiz
        assert "merhaba" in temiz

    def test_javascript_semasi_gecmez(self) -> None:
        temiz = _temiz_aciklama('<a href="javascript:alert(1)">tık</a>') or ""
        assert "javascript:" not in temiz

    def test_iframe_gecmez(self) -> None:
        assert "<iframe" not in (_temiz_aciklama('<iframe src="x"></iframe>') or "")

    def test_izinli_bicimlendirme_korunur(self) -> None:
        temiz = _temiz_aciklama("<p><strong>Kalın</strong> ve <em>eğik</em></p>") or ""
        assert "<strong>" in temiz
        assert "<em>" in temiz

    def test_liste_korunur(self) -> None:
        temiz = _temiz_aciklama("<ul><li>bir</li><li>iki</li></ul>") or ""
        assert temiz.count("<li>") == 2

    def test_duz_metin_zarar_gormez(self) -> None:
        """Mevcut açıklamalar düz metin; göç yok, bozulma da olmamalı."""
        assert _temiz_aciklama("80 gr kağıt, 200 sayfa") == "80 gr kağıt, 200 sayfa"

    def test_bos_ve_none_none_doner(self) -> None:
        assert _temiz_aciklama(None) is None
        assert _temiz_aciklama("") is None

    def test_yalniz_etiketten_ibaret_girdi_none_doner(self) -> None:
        """Temizlikten sonra hiçbir şey kalmadıysa boş dize DEĞİL None yazılır."""
        assert _temiz_aciklama("<script>x</script>") is None


class TestKapsam:
    """Açıklamayı YAZAN her yol temizlikten geçmeli."""

    KAYNAK = Path(__file__).resolve().parents[1] / "services" / "store_service.py"

    def test_dort_yazma_yolu_da_temizlikten_geciyor(self) -> None:
        kaynak = self.KAYNAK.read_text(encoding="utf-8")

        # `description=` ile yapılan HER atama ya temizleyiciyi çağırmalı ya da
        # okuma yolunda (şemaya kopyalama) olmalı.
        atamalar = re.findall(r"description=([^,\n]+)", kaynak)
        yazan = [a for a in atamalar if not a.strip().startswith("p.description")]
        assert yazan, "kaynak taraması hiçbir atama bulamadı (test kendisi bozuk)"
        for a in yazan:
            assert "_temiz_aciklama" in a, (
                f"temizlikten geçmeyen açıklama ataması: description={a}"
            )

    def test_patch_yolu_setattr_dongusunden_once_temizliyor(self) -> None:
        kaynak = self.KAYNAK.read_text(encoding="utf-8")
        temizlik = kaynak.index('data = {**data, "description": _temiz_aciklama')
        dongu = kaynak.index("for field in editable:")
        assert temizlik < dongu, (
            "temizlik `setattr` döngüsünden SONRA yapılıyor; döngü dinamik bir "
            "yazım yolu olduğu için ham HTML sessizce DB'ye girerdi"
        )
