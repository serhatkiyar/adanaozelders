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
      /** Karşı taraf sayfaya gelene dek video sağlayıcısına bağlanılmaz. */
      waiting: {
        title: "{{name}} bekleniyor…",
        titleAnon: "Karşı taraf bekleniyor…",
        hint: "Derse gelince kendiliğinden bağlanacaksın.",
        cancel: "Beklemeyi bırak",
      },
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
      /** Meet `controls.moreOptions` — dar pencerede sağ bölgeyi toplayan ok. */
      moreOptions: "Daha fazla",
      screenShare: {
        start: "Ekranını paylaş",
        stop: "Paylaşımı durdur",
      },
      /**
       * Sohbet düğmesi — adı Preply'daki gibi "Sohbet"; ipucu Preply
       * `classroom.tooltip.tooltip_chat` ("Chat with {userName}").
       * Okunmamışta yalnız nokta (sayı yok); ekran okuyucuya sayısız metin.
       */
      chat: {
        label: "Sohbet",
        tooltip: "{{name}} ile sohbet",
        unread: "Okunmamış mesaj var",
      },
      /** Meet `controls.reactions` — emoji tepkileri (Zoom command channel). */
      reactions: {
        button: "Tepki gönder",
        send: "{{emoji}} tepkisi gönder",
        announce: "{{name}}: {{emoji}}",
      },
      /** Meet `controls.hand`. */
      hand: {
        raise: "El kaldır",
        lower: "Elini indir",
      },
      /** Meet `controls.participants`. */
      participants: {
        open: "Katılımcıları gizle",
        closed: "Katılımcıları gör",
        count_one: "{{count}} katılımcı",
        count_other: "{{count}} katılımcı",
      },
    },
    /** Meet `sidePanel` — Katılımcılar başlığı (sohbetin başlığı kendinde, Preply). */
    sidePanel: {
      ariaLabel: "Yan panel: {{title}}",
      heading: {
        participants: "Katılımcılar",
        chat: "Sohbet",
      },
      closeButton: "Katılımcıları gizle (Esc)",
      escapeHint: "Kapatmak için Esc tuşuna bas",
      resize: "Paneli yeniden boyutlandır",
    },
    /** Meet `participants` — yönetici işlemleri yok. */
    participants: {
      subheading: "Derste",
      you: "sen",
      contributors: "Katılımcılar",
      collapsable: {
        open: "{{name}} listesini aç",
        close: "{{name}} listesini kapat",
      },
      muteYourself: "Mikrofonunu kapat",
      micOn: "Mikrofonu açık",
      micOff: "Mikrofonu kapalı",
    },
    /**
     * Ders içi sohbet: sitenin mesajlaşması, görünümü Preply sınıf sohbeti
     * (Preply `shared.tr` metinleri: "Mesajın", "… için saat", "Mesajları
     * kapat", "Mesaj eylemleri", "Yanıtla", "Kopyala", "… tarafından
     * görüldü", "Gönderildi", "Bugün", "Dün", "… yeni mesaj").
     */
    chat: {
      close: "Mesajları kapat",
      localTime: "{{name}} için saat {{time}}",
      placeholder: "Mesajın",
      actions: "Mesaj eylemleri",
      reply: "Yanıtla",
      copy: "Kopyala",
      react: "{{emoji}} tepkisi",
      seenBy: "{{name}} tarafından görüldü",
      sent: "Gönderildi",
      today: "Bugün",
      yesterday: "Dün",
      newMessages: "{{count}} yeni mesaj",
      scrollDown: "En yeni mesajlara in",
      send: "Gönder",
      sendError: "Mesaj gönderilemedi.",
      charCount: "{{used}} / {{limit}} karakter",
      replyingTo: "{{name}} yanıtlanıyor",
      cancelReply: "Yanıtı kaldır",
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
        participants: "Katılımcılar",
        chat: "Sohbet",
        settings: "Ayarlar",
      },
    },
    participantTile: {
      you: "Sen",
      muted: "Mikrofonu kapalı",
      waiting: "Karşı taraf bekleniyor",
      screenShare: "Paylaşılan ekran: {{name}}",
      myScreenShare: "Ekranını paylaşıyorsun",
      handRaised: "El kaldırdı",
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
        busy: "Karşı taraf ekran paylaşırken paylaşım başlatamazsın.",
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
      backgroundFailed: "Arka plan uygulanamadı; görüntün arka plansız sürüyor.",
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
        weakHint: "Görüntü ve ses kesilebilir.",
      },
    },
    /** Meet `notifications` ad alanı: katıldı / ayrıldı. */
    notifications: {
      joined: "{{name}} derse katıldı",
      left: "{{name}} dersten ayrıldı",
      handRaised: "{{name}} elini kaldırdı ✋",
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
        /** Meet `effects` — arka plan bulanıklaştırma ve düz renk. */
        background: {
          heading: "Arka plan",
          none: "Yok",
          blur: "Bulanıklaştır",
          colors: {
            gri: "Gri",
            lacivert: "Lacivert",
            yesil: "Koyu yeşil",
            bej: "Bej",
          },
          hint: "Karşı taraf arka planını bu seçimle görür.",
          unsupported: "Bu cihazda ya da tarayıcıda arka plan efektleri desteklenmiyor.",
        },
        permissionsRequired: "İzin gerekli",
      },
    },
    /** Beyaz tahta — Preply sınıfı (spesifikasyon `preply-sinif-tahta-duzen.md` §4, §5). */
    tahta: {
      baslik: "Beyaz tahta",
      paylasimli: "Paylaşımlı",
      paylasimliIpucu: "Sen ve {{ad}} beyaz tahtayı görüntüleyip kontrol edebilirsiniz",
      paylasimliIpucuAdsiz: "Beyaz tahtayı birlikte görüntüleyip kontrol edebilirsiniz",
      kapat: "Beyaz tahtayı kapat",
      kapatOnay: {
        baslik: "Beyaz tahta kapatılsın mı?",
        metin: "Bu araç {{ad}} için de kapanacak. Devam edilsin mi?",
        metinAdsiz: "Bu araç karşı taraf için de kapanacak. Devam edilsin mi?",
        birDaha: "Bir daha gösterme",
        iptal: "İptal",
        onay: "Kapat",
      },
      yukleniyor: "Beyaz tahta yükleniyor…",
      acilamadi: "Beyaz tahta açılamadı. Biraz sonra yeniden dene.",
      araclar: {
        cubuk: "Tahta araçları",
        secim: "Seç",
        lazer: "Lazer",
        kalem: "Kalem",
        metin: "Metin",
        sekil: "Şekil",
        silgi: "Silgi",
        temizle: "Temizle",
        el: "Kaydır",
        uygulamalar: "Uygulamalar",
      },
      sekiller: {
        rectangle: "Dikdörtgen",
        ellipse: "Elips",
        diamond: "Eşkenar dörtgen",
        arrow: "Ok",
        line: "Çizgi",
      },
      renk: "Renk",
      kalinlik: "Kalınlık",
      boyut: "Yazı boyutu",
      renkler: {
        siyah: "Siyah",
        kirmizi: "Kırmızı",
        mavi: "Mavi",
        yesil: "Yeşil",
        turuncu: "Turuncu",
      },
      kalinliklar: { ince: "İnce", orta: "Orta", kalin: "Kalın" },
      boyutlar: { kucuk: "Küçük", orta: "Orta", buyuk: "Büyük" },
      uygulama: {
        dosyaYukle: "Dosya yükle",
        resimKaydet: "Resim olarak kaydet",
        pdfKaydet: "PDF olarak kaydet",
      },
      geriAl: "Geri al",
      yinele: "Yinele",
      yakinlastir: "Yakınlaştır",
      uzaklastir: "Uzaklaştır",
      ortala: "Ortala",
      sayfa: {
        denetim: "Sayfalar",
        onceki: "Önceki sayfa",
        sonraki: "Sonraki sayfa",
        ekle: "Sayfa ekle",
        sil: "Sayfayı sil",
        konum: "{{no}}/{{toplam}}",
        silOnay: {
          baslik: "Sayfa silinsin mi?",
          metin: "Bu sayfa ve üstündeki çizimler iki taraf için de silinir.",
          iptal: "İptal",
          onay: "Sil",
        },
      },
      durum: {
        yukleniyor: "Dosya yükleniyor…",
        hazirlaniyor: "PDF hazırlanıyor…",
        sayfaAcilamadi: "PDF sayfası açılamadı.",
        yuklemeHatasi: "Dosya yüklenemedi.",
        yalnizPdf: "Tahtaya yalnız PDF yüklenebilir.",
        bos: "Tahta boş — kaydedilecek bir şey yok.",
        disaAktarilamadi: "Dışa aktarılamadı.",
      },
    },
    /** Alt çubuktaki "Araçlar" (Preply `btn-open-tools`). */
    araclarMenu: {
      dugme: "Araçlar",
      beyazTahta: "Beyaz tahta",
      kapat: "Beyaz tahtayı kapat",
    },
    /** Görünüm modları (Preply `T_`) ve karo üstü "Düzeni değiştir" menüsü. */
    duzen: {
      degistir: "Düzeni değiştir",
      SPOTLIGHT: "Odaklanma",
      GRID: "Kareler",
      SIDEBAR: "Kenar çubuğu",
      CORNER: "Köşe",
      yanPanelBoyutu: "Video paneli genişliği",
      bolmeBoyutu: "Paylaşım ve tahta oranı",
    },
    /** Paylaşım paneli başlığı (Preply: 40px şerit + X). */
    paylasimBasligi: {
      ben: "Ekranını paylaşıyorsun",
      karsi: "{{ad}} ekranını paylaşıyor",
      durdur: "Paylaşımı durdur",
    },
  },
} as const;
