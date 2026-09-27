"""Ayrı süreç olarak koşan arka plan işçileri (API konteynerinden bağımsız).

`python -m workers.<ad>` ile başlatılır; `main.py` (FastAPI app) İMPORT
EDİLMEZ — yalnız `core.database` ve ilgili servisler yüklenir.
"""
