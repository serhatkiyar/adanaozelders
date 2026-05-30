"""Test ortamı kurulumu.

core.config.Settings, .env'siz ortamlarda (CI) zorunlu alanlar için değer bekler.
Uygulama modülleri import edilmeden ÖNCE güvenli test default'larını yerleştiririz.
Bu dosya (rootdir conftest) pytest tarafından test modüllerinden önce yüklenir.
"""
import os

os.environ.setdefault("POSTGRES_USER", "test")
os.environ.setdefault("POSTGRES_PASSWORD", "test")
os.environ.setdefault("POSTGRES_DB", "test")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("AUTO_CREATE_DB", "False")
