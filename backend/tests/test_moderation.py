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
