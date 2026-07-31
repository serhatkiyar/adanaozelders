// QR kamera teşhisi — sahada yanlış teşhis konduğu için yazıldı.
//
// Kurye telefondan yerel ağa `http://192.168.x.x` ile bağlandığında ekran
// "bu tarayıcı kamerayla QR taramayı desteklemiyor" diyordu. Oysa aynı sayfada
// teslim kanıtı fotoğrafı kamerayı açabiliyordu. Sebep tarayıcı değil, güvenli
// bağlam: `BarcodeDetector` ve `navigator.mediaDevices` `[SecureContext]`
// olduğu için düz http üzerinde hiç görünmezler; `<input type="file" capture>`
// ise güvenli bağlam gerektirmez.
import { describe, expect, it } from "vitest";

import { qrScanDiagnosis, qrScanMode, type QrEnvironment } from "./qrCapability";

const env = (over: Partial<QrEnvironment> = {}): QrEnvironment => ({
  isSecureContext: true,
  hasBarcodeDetector: true,
  hasMediaDevices: true,
  protocol: "https:",
  hostname: "adanaozelders.com.tr",
  ...over,
});

describe("qrScanMode", () => {
  it("iki API varsa kamera kullanılır", () => {
    expect(qrScanMode(env())).toBe("camera");
  });

  it("güvenli bağlam değilse sebep GÜVENLİ BAĞLAM'dır, tarayıcı değil", () => {
    // Android Chrome yerel ağda http ile: iki API de gizli. Eski kod buna
    // "tarayıcı desteklemiyor" diyordu — yanlış teşhis.
    const lan = env({
      isSecureContext: false,
      hasBarcodeDetector: false,
      hasMediaDevices: false,
      protocol: "http:",
      hostname: "192.168.1.34",
    });
    expect(qrScanMode(lan)).toBe("insecure-context");
  });

  it("güvenli bağlamda API yoksa tarayıcı kısıtıdır (iOS Safari)", () => {
    const ios = env({
      isSecureContext: true,
      hasBarcodeDetector: false,
      hasMediaDevices: true,
    });
    expect(qrScanMode(ios)).toBe("unsupported-browser");
  });

  it("BarcodeDetector var ama getUserMedia yoksa da kamera açılamaz", () => {
    expect(qrScanMode(env({ hasMediaDevices: false }))).toBe("unsupported-browser");
  });

  it("isSecureContext bilinmiyorsa tarayıcı kısıtı varsayılır (temkinli)", () => {
    // Çok eski bir tarayıcıda alan tanımsız olabilir; o hâlde HTTPS önerisi
    // yanıltıcı olurdu.
    const bilinmiyor = env({ isSecureContext: undefined, hasBarcodeDetector: false });
    expect(qrScanMode(bilinmiyor)).toBe("unsupported-browser");
  });
});

describe("qrScanDiagnosis", () => {
  it("güvensiz bağlamda tarayıcıyı SUÇLAMAZ ve HTTPS'i söyler", () => {
    const d = qrScanDiagnosis(
      env({
        isSecureContext: false,
        hasBarcodeDetector: false,
        hasMediaDevices: false,
        protocol: "http:",
        hostname: "192.168.1.34",
      }),
    );
    expect(d.title).toContain("192.168.1.34");
    expect(d.hint).toContain("HTTPS");
    // Kritik: kullanıcıyı "telefonum yapamıyor" sonucuna götüren ifade OLMASIN.
    expect(d.title.toLowerCase()).not.toContain("desteklemiyor");
    expect(d.hint).toContain("elle");
  });

  it("gerçek tarayıcı kısıtında iOS Safari'yi adıyla söyler", () => {
    const d = qrScanDiagnosis(env({ hasBarcodeDetector: false }));
    expect(d.title.toLowerCase()).toContain("desteklemiyor");
    expect(d.hint).toContain("iOS Safari");
  });
});
