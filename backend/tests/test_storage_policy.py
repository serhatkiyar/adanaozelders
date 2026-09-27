"""MinIO/S3 anonim-okuma bucket policy üreticisi (core/storage.public_read_policy).

Bu policy tek başına bir güvenlik sınırıdır: hassas dosyaların anonim
okunmamasının TEK sebebi, onların önekinin bu belgede listelenmemesidir.
"""
import json

from core.storage import PRIVATE_PREFIX, PUBLIC_PREFIXES, public_read_policy


def _get_object_statement(bucket: str) -> dict:
    doc = json.loads(public_read_policy(bucket))
    stmts = [st for st in doc["Statement"] if "s3:GetObject" in st["Action"]]
    assert len(stmts) == 1
    return stmts[0]


def test_policy_gecerli_json_ve_bucket_arnleri():
    doc = json.loads(public_read_policy("avatars"))
    assert doc["Version"] == "2012-10-17"
    resources = [r for st in doc["Statement"] for r in st["Resource"]]
    assert "arn:aws:s3:::avatars" in resources
    assert "arn:aws:s3:::avatars/profiles/*" in resources


def test_policy_anonim_getobject_izni_yalniz_public_oneklerde():
    st = _get_object_statement("mybucket")
    assert st["Effect"] == "Allow"
    assert st["Principal"] == {"AWS": ["*"]}
    assert st["Resource"] == [
        f"arn:aws:s3:::mybucket/{p}*" for p in PUBLIC_PREFIXES
    ]


def test_policy_tum_bucketi_acmaz():
    """Regresyon: `bucket/*` geri gelirse private önek de anonim okunur hale gelir."""
    st = _get_object_statement("mybucket")
    assert "arn:aws:s3:::mybucket/*" not in st["Resource"]


def test_private_onek_hicbir_izin_kapsaminda_degil():
    doc = json.loads(public_read_policy("mybucket"))
    for stmt in doc["Statement"]:
        for resource in stmt["Resource"]:
            assert PRIVATE_PREFIX not in resource
    # Ve hiçbir public önek, private öneki kapsayan bir şekilde yazılmamış olmalı.
    assert not any(PRIVATE_PREFIX.startswith(p) for p in PUBLIC_PREFIXES)
