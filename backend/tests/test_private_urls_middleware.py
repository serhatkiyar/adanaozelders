"""PresignPrivateUrls ASGI katmanının gerçek bir uygulama üzerindeki davranışı.

Gövde yeniden yazıldığı için ``content-length`` da yeniden yazılmalıdır; yanlış
uzunluk yanıtı sessizce kesip istemcide ayrıştırma hatası üretir.
"""
import json

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse, StreamingResponse
from fastapi.testclient import TestClient

from core import private_urls, storage


def _app() -> FastAPI:
    app = FastAPI()

    @app.get("/gizli")
    async def gizli():
        return {"download_url": storage.object_url("private/digital-assets/x.pdf")}

    @app.get("/acik")
    async def acik():
        return {"avatar_url": storage.object_url("profiles/a.webp")}

    @app.get("/duz", response_class=PlainTextResponse)
    async def duz():
        return storage.object_url("private/answer-keys/k.pdf")

    @app.get("/akis")
    async def akis():
        def gen():
            yield b"bir"
            yield b"iki"

        return StreamingResponse(gen(), media_type="text/plain")

    private_urls.install(app)
    return app


def test_json_yanitta_imzalanir_ve_content_length_tutar():
    with TestClient(_app()) as c:
        r = c.get("/gizli")
    assert r.status_code == 200
    url = r.json()["download_url"]
    assert "X-Amz-Signature" in url
    # İstemci gövdeyi tam okuyabildi → uzunluk başlığı yeniden yazılmış.
    assert int(r.headers["content-length"]) == len(r.content)


def test_public_yanit_degismez():
    with TestClient(_app()) as c:
        r = c.get("/acik")
    assert r.json()["avatar_url"] == storage.object_url("profiles/a.webp")


def test_json_disi_yanita_dokunulmaz():
    """Katman yalnız JSON'a müdahale eder; düz metin olduğu gibi geçer."""
    with TestClient(_app()) as c:
        r = c.get("/duz")
    assert r.text == storage.object_url("private/answer-keys/k.pdf")


def test_akis_yaniti_tamponlanmaz():
    with TestClient(_app()) as c:
        r = c.get("/akis")
    assert r.text == "biriki"


def test_liste_yanitinda_her_kalem_imzalanir():
    app = FastAPI()

    @app.get("/liste")
    async def liste():
        return [
            {"url": storage.object_url(f"private/exam-results/{i}.pdf")}
            for i in range(3)
        ]

    private_urls.install(app)
    with TestClient(app) as c:
        r = c.get("/liste")
    body = json.loads(r.content)
    assert len(body) == 3
    assert all("X-Amz-Signature" in row["url"] for row in body)
