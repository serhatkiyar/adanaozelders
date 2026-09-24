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
      cameraNotGranted: "Kamera izni verilmedi. Karşı taraf seni görebilsin mi?",
      cameraAndMicNotGranted:
        "Kamera ve mikrofon izni verilmedi. Karşı taraf seni görebilsin ve duyabilsin mi?",
      videoPreview: {
        enabled: "Kamera önizlemesi açık",
        disabled: "Kamera önizlemesi kapalı",
      },
      permissionsButton: {
        cameraNotGranted: "Kameraya izin ver",
        cameraAndMicNotGranted: "Kamera ve mikrofona izin ver",
      },
      usernameLabel: "Adın",
      usernameHint: "Karşı tarafa görünen ad",
      lessonTime: "Ders saati",
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
      screenShare: {
        start: "Ekranını paylaş",
        stop: "Paylaşımı durdur",
      },
    },
    selectDevice: {
      loading: "Yükleniyor…",
      select: "Bir cihaz seç",
      permissionsNeeded: "İzin gerekli",
      notFound: "Cihaz bulunamadı",
      settings: {
        audio: "Ses ayarları",
        video: "Görüntü ayarları",
      },
      videoinput: {
        choose: "Kamerayı seç",
        disable: "Kamerayı kapat",
        enable: "Kamerayı aç",
      },
      audioinput: {
        choose: "Mikrofonu seç",
        level: "Mikrofon giriş seviyesi",
        muteTest: "Test etmek için mikrofonunu aç",
        disable: "Mikrofonu kapat",
        enable: "Mikrofonu aç",
      },
      audiooutput: {
        choose: "Hoparlörü seç",
        test: "Hoparlörü test et",
        testing: "Test sesi çalıyor…",
      },
    },
    options: {
      buttonLabel: "Daha fazla seçenek",
      items: {
        switchCamera: "Kamerayı çevir",
        settings: "Ayarlar",
        fullscreen: {
          enter: "Tam ekran",
          exit: "Tam ekrandan çık",
        },
      },
    },
    participantTile: {
      you: "Sen",
      muted: "Mikrofonu kapalı",
      waiting: "Karşı taraf bekleniyor",
      screenShare: "Paylaşılan ekran: {{name}}",
      myScreenShare: "Ekranını paylaşıyorsun",
    },
    /** Meet `error.screenShare` — ekran paylaşımı izni. */
    error: {
      screenShare: {
        title: "Ekranın paylaşılamıyor",
        message: "Tarayıcının bu bilgisayarda ekranı kaydetmesine izin verilmemiş olabilir.",
        settingsInstructions: "İzni şuradan verebilirsin:",
        settingsLabel: {
          macos: "Sistem Ayarları › Gizlilik ve Güvenlik › Ekran Kaydı",
          windows: "Windows gizlilik ayarları",
        },
        retryHint: "İzni verdikten sonra tarayıcıyı yeniden başlatman gerekebilir.",
        closeButton: "Kapat",
        generic: "Ekran paylaşımı başlatılamadı. Yeniden dene.",
      },
    },
    /** Meet `fullScreenWarning` — tüm ekranı paylaşırken sonsuz yansıma. */
    fullScreenWarning: {
      message:
        "Sonsuz yansıma görüntüsünü önlemek için tüm ekranını paylaşma; bunun yerine bir sekme ya da başka bir pencere paylaş.",
      stop: "Sunumu durdur",
      ignore: "Yoksay",
    },
    media: {
      startAudio: "Sesi aç",
      startAudioHint: "Tarayıcı sesi engelledi. Karşı tarafı duymak için dokun.",
      deviceError: "Cihaz başlatılamadı. İzinleri kontrol edip yeniden dene.",
      micNotGranted:
        "Mikrofon izni verilmedi; karşı tarafı duyabilirsin ama o seni duyamaz. Tarayıcı ayarlarından izin verebilirsin.",
      speakingWhileMuted: "Mikrofonun kapalı. Konuşmak için aç.",
      activeMediaFailed:
        "Ses ya da görüntü beklenmedik biçimde durdu. Düzeltmek için sayfayı yenile.",
      reload: "Sayfayı yenile",
    },
    connection: {
      reconnecting: "Bağlantı koptu, yeniden bağlanılıyor…",
      participantReconnecting: "Yeniden bağlanıyor…",
      quality: {
        label: "Bağlantı: {{durum}}",
        iyi: "iyi",
        orta: "orta",
        zayif: "zayıf",
        bilinmiyor: "bilinmiyor",
        unknownHint: "Bağlantı kalitesi yalnız kamera açıkken ölçülür.",
        weakHint: "Görüntü ve ses kesilebilir.",
      },
    },
    /** Meet `notifications` ad alanı: katıldı / ayrıldı. */
    notifications: {
      joined: "{{name}} derse katıldı",
      left: "{{name}} dersten ayrıldı",
    },
    /** Meet `Permissions` — tarayıcı izin yönlendirmesi. */
    permissionErrorDialog: {
      heading: {
        camera: "Bu site kamerana erişemiyor",
        microphone: "Bu site mikrofonuna erişemiyor",
        cameraAndMicrophone: "Bu site kamerana ve mikrofonuna erişemiyor",
      },
      body: {
        openMenu: {
          chromium: "Adres çubuğunun solundaki site ayarları simgesine tıkla.",
          chromiumTelefon: "Adres çubuğundaki site ayarları simgesine dokun ve “İzinler”i aç.",
          firefox: "Adres çubuğunun solundaki kamera ya da mikrofon simgesine tıkla.",
          safari: "Safari menüsünden “{{alan}} Ayarları”nı aç.",
          ios: "Adres çubuğundaki “aA” simgesine dokun ve “Web Sitesi Ayarları”nı aç.",
        },
        details: {
          camera: "Kamera için “İzin ver”i seç.",
          microphone: "Mikrofon için “İzin ver”i seç.",
          cameraAndMicrophone: "Kamera ve mikrofon için “İzin ver”i seç.",
        },
        retry: "Ardından “Yeniden dene”ye bas. Gerekirse sayfayı yenile.",
      },
      retry: "Yeniden dene",
    },
    /** Meet `SystemPermissions` — izin verildiği hâlde sistem engelliyorsa. */
    systemPermissionDialog: {
      heading: "Hâlâ çalışmıyor mu?",
      device: {
        camera: "kamerana",
        microphone: "mikrofonuna",
        cameraAndMicrophone: "kamerana ve mikrofonuna",
      },
      intro: "Tarayıcı izin verse de cihazının ayarları {{device}} erişimi engelliyor olabilir.",
      steps: {
        macos: "Sistem Ayarları’nda “Gizlilik ve Güvenlik”i aç ve tarayıcına izin ver.",
        windows: "Windows Ayarları’nda “Gizlilik ve güvenlik”i aç; erişimi ve masaüstü uygulamalarını aç.",
        android: "Android Ayarları’nda “Uygulamalar”dan tarayıcını seç, “İzinler”den izin ver.",
        ios: "iPhone Ayarları’nda tarayıcını seç ve kamera/mikrofon iznini aç.",
        diger: "Sistem gizlilik ayarlarından tarayıcına izin ver.",
      },
      openSettings: "Sistem ayarlarını aç",
    },
    /** Meet `settings` ad alanı (yalnız Ses ve Görüntü sekmeleri). */
    settings: {
      dialog: {
        heading: "Ayarlar",
      },
      tabs: {
        audio: "Ses",
        video: "Görüntü",
      },
      audio: {
        microphone: {
          heading: "Mikrofon",
          label: "Ses girişini seç",
          disabled: "Mikrofon kapalı",
        },
        speakers: {
          heading: "Hoparlör",
          label: "Ses çıkışını seç",
          test: "Test et",
          ongoingTest: "Test sesi çalıyor…",
          safariWarning:
            "Bu tarayıcıda hoparlör seçilemiyor; ses cihazın varsayılan çıkışından gelir.",
        },
        permissionsRequired: "İzin gerekli",
      },
      video: {
        camera: {
          heading: "Kamera",
          label: "Görüntü girişini seç",
          disabled: "Kamera kapalı",
          enabled: "Kamera açık",
        },
        mirror: {
          heading: "Aynalama",
          label: "Kendi görüntümü aynalı göster",
          hint: "Yalnız sende değişir; karşı taraf seni her zaman düz görür.",
        },
        permissionsRequired: "İzin gerekli",
      },
    },
  },
} as const;
