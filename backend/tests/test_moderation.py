from core.moderation import mask_contact_info


def test_masks_phone_numbers():
    assert "[gizlendi]" in mask_contact_info("Beni ara 0532 123 45 67")
    assert "[gizlendi]" in mask_contact_info("tel: +90 532 123 4567")


def test_masks_email():
    out = mask_contact_info("mail at ahmet.hoca@gmail.com lütfen")
    assert "[gizlendi]" in out
    assert "gmail.com" not in out


def test_leaves_clean_text_untouched():
    text = "Yarınki ders için 3. üniteyi çalış."
    assert mask_contact_info(text) == text


def test_handles_none_and_empty():
    assert mask_contact_info(None) is None
    assert mask_contact_info("") == ""


# ── Yanlış pozitifler ───────────────────────────────────────────────────────
# Maske profil metinlerine de uygulanıyor; eğitmen biyografilerinde tarih
# aralığı, soru numarası ve fiyat çok yaygındır. Bunları gizlemek ürünü
# sessizce bozar — ilk regex "2020 - 2024 arası" ifadesini gizliyordu.


def test_yil_araligi_maskelenmez():
    for text in (
        "2020 - 2024 arası lisans eğitimimi tamamladım.",
        "2015-2019 ODTÜ Matematik",
        "1998 doğumluyum, 2021 mezunuyum.",
    ):
        assert mask_contact_info(text) == text


def test_sayi_listesi_maskelenmez():
    text = "Deneme sınavında 1 2 3 4 5 6 7 8 9 10 numaralı soruları çözdük."
    assert mask_contact_info(text) == text


def test_saat_ve_fiyat_maskelenmez():
    for text in (
        "Ders saati 14:00 - 16:00 arası.",
        "Ücret 1.250,00 TL",
        "Kitap 129,90 TL",
    ):
        assert mask_contact_info(text) == text


def test_isbn_maskelenmez():
    text = "ISBN 978-605-123-456-7 olan baskısı daha güncel."
    assert mask_contact_info(text) == text


# ── Atlatma yolları ─────────────────────────────────────────────────────────


def test_bosluksuz_numara_maskelenir():
    assert "[gizlendi]" in mask_contact_info("numaram 05321234567")


def test_noktali_ve_parantezli_numara_maskelenir():
    assert "[gizlendi]" in mask_contact_info("(0532) 123.45.67 arayın")


def test_dogrudan_mesajlasma_linki_maskelenir():
    for text in (
        "wa.me/905321234567 üzerinden yazın",
        "T.me/ahmethoca kanalıma katılın",
        "https://api.whatsapp.com/send?phone=905321234567",
    ):
        out = mask_contact_info(text)
        assert "[gizlendi]" in out
        assert "905321234567" not in out


def test_karisik_metinde_yalniz_numara_gizlenir():
    out = mask_contact_info(
        "2018-2022 Çukurova Üniversitesi mezunuyum, 0532 123 45 67 numaralıyım."
    )
    assert "2018-2022 Çukurova Üniversitesi" in out
    assert "0532" not in out
