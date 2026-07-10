"""MinIO/S3 anonim-okuma bucket policy üreticisi (core/storage.public_read_policy)."""
import json

from core.storage import public_read_policy


def test_policy_gecerli_json_ve_bucket_arnleri():
    doc = json.loads(public_read_policy("avatars"))
    assert doc["Version"] == "2012-10-17"
    resources = [r for st in doc["Statement"] for r in st["Resource"]]
    assert "arn:aws:s3:::avatars" in resources
    assert "arn:aws:s3:::avatars/*" in resources


def test_policy_anonim_getobject_izni():
    doc = json.loads(public_read_policy("mybucket"))
    obj_stmts = [
        st for st in doc["Statement"] if "s3:GetObject" in st["Action"]
    ]
    assert len(obj_stmts) == 1
    st = obj_stmts[0]
    assert st["Effect"] == "Allow"
    assert st["Principal"] == {"AWS": ["*"]}
    assert st["Resource"] == ["arn:aws:s3:::mybucket/*"]
