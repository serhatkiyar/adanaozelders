/**
 * Canlı ders odasının metinleri (Türkçe). Anahtar adları La Suite Meet'in
 * `locales/*\/rooms.json` dosyasındaki gibi kalır; metinler oradan uyarlandı
 * (Meet, MIT — DINUM/Etalab; bkz. frontend/THIRD_PARTY_NOTICES.md).
 *
 * `.json` değil `.ts`: kaynak taramalı nöbetçiler (`rolEtiketi` vb.) yalnız
 * `.ts/.tsx` okur; metin burada da denetim altında kalsın.
 */
export const tr = {
  rooms: {
    join: {
      heading: "Derse katılmaya hazır mısın?",
      joinLabel: "Derse katıl",
      joining: "Katılınıyor…",
      cameraDisabled: "Kamera kapalı.",
      cameraStarting: "Kamera açılıyor…",
      cameraNotFound: "Kamera bulunamadı. Doğru takıldığından emin ol.",
      cameraInUse:
        "Kameran kullanılamıyor. Büyük olasılıkla başka bir uygulama ya da sekme kullanıyor.",
      cameraNotGranted: "Kamera izni verilmedi. Tarayıcı ayarlarından izin verebilirsin.",
      micHint: "Mikrofonun derse {{durum}} girer.",
      micOn: "açık",
      micOff: "kapalı",
      errors: {
        join: "Derse katılınamadı. Biraz bekleyip yeniden dene.",
        ticket: "Giriş bileti yenilenemedi. Sayfayı yenileyip yeniden dene.",
      },
    },
    controls: {
      region: "Ders kontrolleri",
      microphone: "Mikrofon",
      camera: "Kamera",
      leave: "Ayrıl",
      leaveShort: "Çık",
      moreOptions: "Daha fazla",
    },
    selectDevice: {
      videoinput: {
        disable: "Kamerayı kapat",
        enable: "Kamerayı aç",
      },
      audioinput: {
        disable: "Mikrofonu kapat",
        enable: "Mikrofonu aç",
      },
    },
    options: {
      buttonLabel: "Daha fazla seçenek",
      items: {
        switchCamera: "Kamerayı çevir",
      },
    },
    participantTile: {
      you: "Sen",
      muted: "Mikrofonu kapalı",
      waiting: "Karşı taraf bekleniyor",
    },
    media: {
      startAudio: "Sesi aç",
      startAudioHint: "Tarayıcı sesi engelledi. Karşı tarafı duymak için dokun.",
      deviceError: "Cihaz başlatılamadı. İzinleri kontrol edip yeniden dene.",
      micNotGranted:
        "Mikrofon izni verilmedi; karşı tarafı duyabilirsin ama o seni duyamaz. Tarayıcı ayarlarından izin verebilirsin.",
    },
    connection: {
      reconnecting: "Bağlantı koptu, yeniden bağlanılıyor…",
    },
  },
} as const;
