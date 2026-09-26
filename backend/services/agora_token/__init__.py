"""AgoraIO/Tools resmî Python token kodu — DEĞİŞTİRİLMEDEN vendorlandı.

Kaynak: https://github.com/AgoraIO/Tools/tree/master/DynamicKey/AgoraDynamicKey/python3/src
Dosyalar: AccessToken2.py, RtcTokenBuilder2.py, Packer.py (upstream commit
d9b93a53e4e2c6b4d035e3bb824b6ce8f0e052e0, 2026-07-25). Lisans: MIT, bkz. LICENSE.

Neden vendor: Agora'nın resmî bir PyPI paketi yok; PyPI'daki
`agora-token-builder` topluluk paketi eski ("006") AccessToken üretir.
Bu dosyalar "007" AccessToken2 üretir. Güncellemek için üç dosyayı upstream'den
aynen kopyalayın; yerel değişiklik yapmayın (ruff muafiyeti ruff.toml'da).
"""
