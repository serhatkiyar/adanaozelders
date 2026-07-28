import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const inputCsv = "C:/Users/kiyar/Downloads/dataset_crawler-google-places_2026-07-18_09-16-44-612(1).csv";
const outputDir = "C:/Users/kiyar/Desktop/ceyhan-tutor-market/outputs/adana_kitap_toptancilari_20260718";
const outputXlsx = `${outputDir}/Adana_Kitap_Toptancilari_Analizi.xlsx`;

const csvText = await fs.readFile(inputCsv, "utf8");
const imported = await Workbook.fromCSV(csvText, { sheetName: "Kaynak" });
const rawValues = imported.worksheets.getItemAt(0).getUsedRange().values;
const headers = rawValues[0].map((v, i) => (i === 0 ? String(v ?? "").replace(/^\uFEFF/, "") : String(v ?? "")));
const rows = rawValues.slice(1).map((vals) => Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""])));

const str = (v) => String(v ?? "").trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v) => String(v).toLowerCase() === "true";
const cats = (r) => [0,1,2,3,4,5,6,7,8,9].map((i) => str(r[`categories/${i}`])).filter(Boolean).join("; ");
const mapsSearch = (name, address = "Adana") => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}`;
const findRow = (title) => rows.find((r) => str(r.title) === title);

const classify = (r) => {
  const title = str(r.title);
  const category = str(r.categoryName);
  const allCats = cats(r);
  const blob = `${title} ${category} ${allCats}`.toLocaleLowerCase("tr-TR");
  if (bool(r.permanentlyClosed)) return ["D - Elendi", "Google Maps kaydı kalıcı olarak kapalı görünüyor."];
  if (title === "Bilgi Dağıtım") return ["D - Güncellik sorunu", "Açık web kaydı, Bilgi Dağıtım'ın toptancılığı 2014'te bıraktığını belirtiyor; mevcut faaliyet telefonla doğrulanmalı."];
  if (title === "FDD FORMÜL | Fon Yayıncılık") return ["A - Öncelikli", "Adana merkezli eğitim yayıncısı; doğrudan yayıncı tedariği için güçlü aday."];
  if (title === "Kardeşler Dağıtım") return ["A - Öncelikli", "Açık web kaydında toptan kitap ve kırtasiye dağıtımı açıkça belirtiliyor."];
  if (title.includes("Türkmenoğlu Kırtasiye")) return ["B - Kapsam teyidi", "B2B/e-bayi ve kırtasiye toptan faaliyeti doğrulanıyor; kitap markaları ayrıca sorulmalı."];
  if (title === "MERKEZ DAVET Kitap Kırtasiye paz. ve tic ltd şti." || title === "TRKİTAP" || title === "TamamAL") return ["B - Muhtemel", "Aynı adres ve telefonla ilişkili kitap/yayın grubu; toptan ve bayi şartları teyit edilmeli."];
  if (title === "Aydın Dağıtım") return ["B - Muhtemel", "Dağıtım hizmeti kaydı var; kitap dağıtımı yaptığına dair açık kanıt bulunamadı."];
  if (blob.includes("yayıncı") || blob.includes("kitap yayıncısı") || blob.includes("yayınevi") || blob.includes("yayıncılık")) {
    return ["B - Muhtemel", "Yayıncılık faaliyeti var; doğrudan satış, bayi ve iskonto koşulları teyit edilmeli."];
  }
  if (blob.includes("kitapçı") || blob.includes("kitabevi") || blob.includes("kırtasiye")) {
    return ["C - Perakende/teyit", "Kitap veya kırtasiye satışı var; toptan çalıştığına dair doğrudan kanıt yok."];
  }
  return ["D - Alakasız", "Arama sorgusuna düşmüş ancak kitap toptancılığıyla belirgin ilişkisi yok."];
};

const candidates = [
  {
    priority: "A", name: "Yıldırım Dağıtım", type: "Kitap ve kırtasiye toptancısı",
    why: "Resmî sitesinde 1997'de kitap toptancılığıyla başladığını, B2B sipariş ve Adana içi günlük teslimat sunduğunu belirtiyor.",
    phone: "+90 322 431 13 14", email: "info@yildirimdagitim.com", district: "Seyhan",
    address: "Yeşiloba Mah. 46235 Sk. No:4/A, Seyhan/Adana", website: "https://www.yildirimdagitim.com/",
    map: mapsSearch("Yıldırım Dağıtım", "Yeşiloba Adana"), source: "https://www.yildirimdagitim.com/", origin: "Web araştırması",
    note: "İlk aranacak firma; genel kitap portföyü, minimum sipariş ve Ceyhan teslimatı sorulmalı."
  },
  {
    priority: "A", name: "TEMA Yayın Dağıtım", type: "Eğitim yayınları bölge dağıtıcısı",
    why: "Endemik Yayınları resmî bayi sayfasında Adana-Osmaniye hizmet bölgesiyle listeleniyor.",
    phone: "0532 650 53 95 / 0506 291 54 99", email: "basarkaradag@gmail.com", district: "Seyhan",
    address: "Reşatbey Mah. Ordu Cad. 62018 Sk. Yarman Apt. Kat:1 D:2, Seyhan/Adana", website: "",
    map: mapsSearch("TEMA Yayın Dağıtım", "Reşatbey Adana"), source: "https://bayilerimiz.endemikyayinlari.com.tr/", origin: "Web araştırması",
    note: "Özellikle eğitim, LGS ve YKS yayınları için güçlü aday."
  },
  {
    priority: "A", name: "Kardeşler Dağıtım", type: "Toptan kitap ve kırtasiye",
    why: "Firma kaydında toptan kitap, kırtasiye, büro ve okul malzemesi dağıtımı açıkça yazıyor.",
    phone: "+90 322 433 20 69", email: "", district: "Seyhan",
    address: "Hurmalı, Kurtuluş Cd. No:43, Seyhan/Adana", website: "",
    map: str(findRow("Kardeşler Dağıtım")?.url) || mapsSearch("Kardeşler Dağıtım", "Seyhan Adana"),
    source: "https://www.firmaadimiz.com/kardesler_dagitim_toptan_kirtasiye-ictvnte.html", origin: "CSV + web doğrulaması",
    note: "Kaynaklarda adres farklılıkları var; güncel depo/mağaza adresi telefonda teyit edilmeli."
  },
  {
    priority: "A", name: "Dörtler Dağıtım Kitap Kırtasiye", type: "Eğitim yayınları bayisi/dağıtıcısı",
    why: "Yayıncı bayi listesinde bayi olarak yer alıyor; firma unvanında dağıtım ve kitap bulunuyor.",
    phone: "0532 456 37 87", email: "dortler-adana@hotmail.com", district: "Çukurova",
    address: "Huzurevleri Mah. Türkmenbaşı Blv. No:58/B, Çukurova/Adana", website: "",
    map: mapsSearch("Dörtler Dağıtım Kitap Kırtasiye", "Çukurova Adana"), source: "https://bayi.merthoca.com/", origin: "Web araştırması",
    note: "Yayın çeşitliliği ve kurumsal iskonto oranı sorulmalı."
  },
  {
    priority: "A", name: "Adarak Dağıtım Pazarlama", type: "Eğitim yayınları bayisi/dağıtıcısı",
    why: "Hız Yayınları resmî bayi listesinde ortaokul ve lise ürünleri için listeleniyor.",
    phone: "0542 280 05 66", email: "", district: "Çukurova",
    address: "Karslılar Mah. 82072 Sok. No:16 İç Kapı No:2, Çukurova/Adana", website: "",
    map: mapsSearch("Adarak Dağıtım Pazarlama", "Çukurova Adana"), source: "https://hizyayinlari.com/iletisim/bayiler/adana/", origin: "Web araştırması",
    note: "Eğitim yayınları için öncelikli aranmalı."
  },
  {
    priority: "A", name: "FDD FORMÜL | Fon Yayıncılık", type: "Doğrudan eğitim yayıncısı",
    why: "Adana merkezli yayıncı; FDD, Formül, Fon Pratik, Antikor ve diğer eğitim markalarını üretiyor.",
    phone: "+90 850 302 85 23 / +90 322 363 61 19", email: "info@fonyayincilik.com.tr", district: "Seyhan",
    address: "Dr. Ali Menteşoğlu Cad. No:10/203 Kat:2, Kuruköprü, Seyhan/Adana", website: "https://www.fonyayincilik.com.tr/",
    map: str(findRow("FDD FORMÜL | Fon Yayıncılık")?.url) || mapsSearch("Fon Yayıncılık", "Seyhan Adana"), source: "https://www.fonyayincilik.com.tr/biz-kimiz", origin: "CSV + resmî web",
    note: "Kendi yayınları için doğrudan bayi/toptan fiyatı istenmeli."
  },
  {
    priority: "B", name: "Türkmenoğlu Kırtasiye / Dağıtım", type: "B2B kırtasiye toptancısı",
    why: "E-bayi sözleşmesi ve ticaret kayıtları B2B/toptan kırtasiye faaliyetini destekliyor; kitap kapsamı net değil.",
    phone: "+90 322 435 82 77 / +90 322 352 89 03", email: "info@turkmenoglukirtasiye.com", district: "Seyhan",
    address: "Hurmalı, Kurtuluş Cd. No:13 ve Tepebağ, Cemal Gürsel Cd. No:39/B, Seyhan/Adana", website: "https://www.turkmenogludagitim.com/",
    map: str(findRow("Türkmenoğlu Kırtasiye Tic. ve San. A.Ş.")?.url) || mapsSearch("Türkmenoğlu Kırtasiye", "Seyhan Adana"),
    source: "https://www.turkmenogludagitim.com/storage/b2b_turkmen_ebayi.pdf", origin: "CSV + web doğrulaması",
    note: "Kitap markaları ve bayi hesabı açılışı özellikle sorulmalı."
  },
  {
    priority: "B", name: "Şafak Okul İhtiyaçları Dağıtım", type: "Eğitim yayınları satış noktası/dağıtım",
    why: "Yayıncı bayi listesinde satış noktası olarak listeleniyor; unvanında dağıtım ve kitap bulunuyor.",
    phone: "0541 415 37 53", email: "safakkitap@hotmail.com", district: "Çukurova",
    address: "Huzurevleri Mah. Türkmenbaşı Blv. No:68/A, Çukurova/Adana", website: "",
    map: mapsSearch("Şafak Okul İhtiyaçları Dağıtım", "Çukurova Adana"), source: "https://bayi.merthoca.com/", origin: "Web araştırması",
    note: "Toptan çalışma ve yayınevi portföyü teyit edilmeli."
  },
  {
    priority: "B", name: "Mersedes Kitap Kırtasiye", type: "Yayıncı bayisi/satış noktası",
    why: "Yargı Ders Arkadaşım resmî bayi sayfasında Seyhan satış noktası olarak listeleniyor.",
    phone: "0553 892 19 23", email: "", district: "Seyhan",
    address: "Gürselpaşa Mah. 75163 Sok. B Blok No:4, Seyhan/Adana", website: "",
    map: mapsSearch("Mersedes Kitap Kırtasiye", "Gürselpaşa Adana"), source: "https://www.yargidersarkadasim.com.tr/bayilerimiz", origin: "Web araştırması",
    note: "Bayi mi, perakende satış noktası mı olduğu teyit edilmeli."
  },
  {
    priority: "B", name: "APSİS Yayıncılık", type: "Yayıncı/bayi",
    why: "Evrensel İletişim Yayınları bayi listesinde Adana kaydı bulunuyor.",
    phone: "0543 611 82 98", email: "", district: "Çukurova",
    address: "Güzelyalı Mah. Turgut Özal Blv. No:68/G, Çukurova/Adana", website: "",
    map: mapsSearch("APSİS Yayıncılık", "Çukurova Adana"), source: "https://www.evrenseliletisim.com.tr/Home/Bayiler", origin: "Web araştırması",
    note: "Doğrudan yayıncı mı, bölgesel bayi mi ve toptan şartları nedir sorulmalı."
  },
  {
    priority: "B", name: "Ömer Akkaya Dağıtım", type: "Eğitim yayınları bayisi/dağıtım",
    why: "Hız Yayınları resmî bayi listesinde Yüreğir lise ürünleri için yer alıyor.",
    phone: "", email: "", district: "Yüreğir",
    address: "Güzelevler Mah. 2067/2 Sk., Yüreğir/Adana", website: "",
    map: mapsSearch("Ömer Akkaya Dağıtım", "Yüreğir Adana"), source: "https://hizyayinlari.com/iletisim/bayiler/adana-lise/", origin: "Web araştırması",
    note: "Telefon bilgisi eksik; harita veya yayınevi üzerinden istenmeli."
  },
  {
    priority: "B", name: "Merkez Davet / TRKitap / TamamAL", type: "Kitap-kırtasiye ve yayın grubu",
    why: "CSV'de aynı adres ve telefonla üç ilişkili kitap/yayın kaydı bulunuyor; toptan faaliyet açıkça doğrulanmadı.",
    phone: "+90 322 352 30 30", email: "", district: "Seyhan",
    address: "Türkocağı, Debboy Cd. No:20, Seyhan/Adana", website: "https://trkitap.com/",
    map: str(findRow("MERKEZ DAVET Kitap Kırtasiye paz. ve tic ltd şti.")?.url) || mapsSearch("Merkez Davet Kitap", "Seyhan Adana"),
    source: str(findRow("MERKEZ DAVET Kitap Kırtasiye paz. ve tic ltd şti.")?.url), origin: "CSV",
    note: "Kurumsal/toptan sipariş, bayi indirimi ve temsil edilen yayınevleri sorulmalı."
  },
  {
    priority: "B", name: "Kayahan Kültür Yayınları", type: "Kitap yayıncısı",
    why: "Google Maps kaydında kitap yayıncısı olarak sınıflandırılmış; doğrudan yayın tedariği ihtimali var.",
    phone: "+90 543 587 19 07", email: "", district: "Seyhan",
    address: "İstiklal, 40012 Sk. No:22 Zemin Kat, Seyhan/Adana", website: "",
    map: str(findRow("Kayahan Kültür Yayınları")?.url), source: str(findRow("Kayahan Kültür Yayınları")?.url), origin: "CSV",
    note: "Aktif katalog ve toptan satış şartları teyit edilmeli."
  },
  {
    priority: "B", name: "Erva Yayıncılık", type: "Yayıncı",
    why: "Google Maps kaydında yayıncı olarak sınıflandırılmış; ancak web sitesi ve katalog bilgisi yok.",
    phone: "+90 530 927 44 25", email: "", district: "Seyhan",
    address: "Sümer, İbo Osman Cd., Gülat Apt., Seyhan/Adana", website: "",
    map: str(findRow("Erva Yayıncılık")?.url), source: str(findRow("Erva Yayıncılık")?.url), origin: "CSV",
    note: "Faaliyet durumu, katalog ve bayi satışı telefonda doğrulanmalı."
  },
  {
    priority: "C", name: "Sarus Yayıncılık Limited Şirketi", type: "Yayıncı",
    why: "Google Maps'te yayıncı kaydı var fakat telefon ve web sitesi bulunmuyor.",
    phone: "", email: "", district: "Seyhan",
    address: "Reşatbey, Dr. Ali Menteşoğlu Cd. No:3, Seyhan/Adana", website: "",
    map: str(findRow("Sarus Yayıncılık Limited Şirketi")?.url), source: str(findRow("Sarus Yayıncılık Limited Şirketi")?.url), origin: "CSV",
    note: "Düşük öncelik; önce aktif iletişim bilgisi bulunmalı."
  },
  {
    priority: "C", name: "Aydın Dağıtım", type: "Dağıtım hizmetleri",
    why: "Google Maps'te dağıtım hizmeti kaydı var; kitap/yayın dağıtımı yaptığına dair açık kanıt yok.",
    phone: "+90 322 346 66 81", email: "", district: "Seyhan",
    address: "Gürselpaşa, Kıyıboyu Cd. / 75020 Sok., Seyhan/Adana", website: "",
    map: str(findRow("Aydın Dağıtım")?.url), source: str(findRow("Aydın Dağıtım")?.url), origin: "CSV",
    note: "Kısa telefon teyidi yapılabilir; kitapla ilgisizse elenmeli."
  },
  {
    priority: "C", name: "İşler Kitabevi Çarşı Şube", type: "Perakende kitabevi",
    why: "Geniş eğitim kitabı portföyü olan yerleşik kitabevi; toptan çalışma kanıtı yok.",
    phone: "+90 322 363 13 95", email: "", district: "Seyhan",
    address: "Çınarlı, 61006 Sk. No:26/C, Seyhan/Adana", website: "http://www.isler.com.tr/",
    map: str(findRow("İŞLER KİTABEVİ ÇARŞI ŞUBE")?.url), source: str(findRow("İŞLER KİTABEVİ ÇARŞI ŞUBE")?.url), origin: "CSV",
    note: "Kurumsal satış veya yüksek adet indirimi olup olmadığı sorulabilir."
  },
  {
    priority: "C", name: "Karahan Kitabevi", type: "Perakende kitabevi",
    why: "Yerleşik kitabevi; toptan faaliyet için doğrudan kanıt yok.",
    phone: "+90 322 363 05 84", email: "", district: "Seyhan",
    address: "Kayalıbağ, 26001 Sk. Özel Sancak İş Hanı, Seyhan/Adana", website: "http://karahankitabevi.com/",
    map: str(findRow("Karahan Kitabevi")?.url), source: str(findRow("Karahan Kitabevi")?.url), origin: "CSV",
    note: "Yüksek adet/kurumsal satış indirimi sorulabilir."
  },
  {
    priority: "C", name: "Kitapsan", type: "Perakende kitabevi",
    why: "Büyük ve aktif kitabevi; toptan faaliyet için doğrudan kanıt yok.",
    phone: "+90 322 459 49 54", email: "", district: "Seyhan",
    address: "Reşatbey, Gazipaşa Blv., Bahri Bey Apt., Seyhan/Adana", website: "http://www.kitapsan.com.tr/",
    map: str(findRow("Kitapsan")?.url), source: str(findRow("Kitapsan")?.url), origin: "CSV",
    note: "Kurumsal satış ve toplu alım indirimi sorulabilir."
  },
  {
    priority: "C", name: "Seyhan Dağıtım", type: "Kırtasiye/ofis malzemesi dağıtımı",
    why: "Açık web kaydı kırtasiye ve ofis malzemesi satışını doğruluyor; kitap kapsamı belirtilmiyor.",
    phone: "+90 322 436 44 44", email: "", district: "Seyhan",
    address: "Yeşiloba, Seyhan Ticaret Merkezi, T. Cemal Beriker Blv. No:19 C Blok, Seyhan/Adana", website: "",
    map: mapsSearch("Seyhan Dağıtım", "Yeşiloba Adana"), source: "https://bioyla.com/isletme-detay/seyhan-dagitim-7861", origin: "Web araştırması",
    note: "Kitap dağıtımı yapıp yapmadığı kısa telefon görüşmesiyle sorulabilir."
  },
  {
    priority: "D", name: "Bilgi Dağıtım / Bigpoint", type: "Eski toptancı; güncellik sorunu",
    why: "Şirket tarihçesi, Adana toptan dağıtım merkezinin açıldığını ancak toptancılığın 2014'te bırakıldığını belirtiyor.",
    phone: "", email: "", district: "Seyhan",
    address: "İstiklal, Bakımyurdu Cd., Seyhan/Adana", website: "https://bigpointb2b.com/",
    map: str(findRow("Bilgi Dağıtım")?.url), source: "https://bigpointb2b.com/sayfalar/sayfa?SistemAdi=Hakkimizda", origin: "CSV + web doğrulaması",
    note: "Öncelikli arama listesinden çıkarıldı; yalnız güncel durum ayrıca teyit edilirse değerlendirilmeli."
  }
];

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Özet");
const shortlist = workbook.worksheets.add("Öncelikli Adaylar");
const raw = workbook.worksheets.add("Ham Veri");

const navy = "#17324D";
const blue = "#1F4E78";
const lightBlue = "#DCE6F1";
const pale = "#F5F7FA";
const green = "#D9EAD3";
const amber = "#FFF2CC";
const red = "#F4CCCC";
const gray = "#E7E6E6";
const white = "#FFFFFF";

// Öncelikli adaylar
shortlist.showGridLines = false;
shortlist.getRange("A1:O1").merge();
shortlist.getRange("A1").values = [["Adana Kent Merkezi — Kitap Toptancısı ve Dağıtıcı Adayları"]];
shortlist.getRange("A2:O2").merge();
shortlist.getRange("A2").values = [["A: önce ara · B: kapsamı teyit et · C: toplu alım indirimi sor · D: şimdilik ele"]];
const shortlistHeaders = ["Sıra", "Öncelik", "Firma", "Tür", "Neden aday / kanıt", "Telefon", "E-posta", "İlçe", "Adres", "Web sitesi", "Harita", "Kanıt kaynağı", "Veri kaynağı", "Doğrulama durumu", "Görüşme notu"];
shortlist.getRange("A4:O4").values = [shortlistHeaders];
const shortlistRows = candidates.map((c, i) => [i + 1, c.priority, c.name, c.type, c.why, c.phone, c.email, c.district, c.address, c.website, c.map, c.source, c.origin, "Aranacak", c.note]);
shortlist.getRangeByIndexes(4, 0, shortlistRows.length, shortlistHeaders.length).values = shortlistRows;
const shortlistEnd = 4 + shortlistRows.length;
const shortlistTable = shortlist.tables.add(`A4:O${shortlistEnd}`, true, "AdaylarTable");
shortlistTable.style = "TableStyleMedium2";
shortlistTable.showBandedRows = true;
shortlist.freezePanes.freezeRows(4);
shortlist.getRange(`N5:N${shortlistEnd}`).dataValidation = { rule: { type: "list", values: ["Aranacak", "Arandı - uygun", "Arandı - uygun değil", "Yanıt bekleniyor"] } };
shortlist.getRange(`B5:B${shortlistEnd}`).conditionalFormats.add("containsText", { text: "A", format: { fill: green, font: { bold: true, color: "#274E13" } } });
shortlist.getRange(`B5:B${shortlistEnd}`).conditionalFormats.add("containsText", { text: "B", format: { fill: amber, font: { bold: true, color: "#7F6000" } } });
shortlist.getRange(`B5:B${shortlistEnd}`).conditionalFormats.add("containsText", { text: "C", format: { fill: lightBlue, font: { bold: true, color: navy } } });
shortlist.getRange(`B5:B${shortlistEnd}`).conditionalFormats.add("containsText", { text: "D", format: { fill: red, font: { bold: true, color: "#990000" } } });
shortlist.getRange("A1:O1").format = { fill: navy, font: { color: white, bold: true, size: 16 }, horizontalAlignment: "left", verticalAlignment: "center" };
shortlist.getRange("A2:O2").format = { fill: lightBlue, font: { color: navy, italic: true }, verticalAlignment: "center" };
shortlist.getRange("A4:O4").format = { fill: blue, font: { color: white, bold: true }, verticalAlignment: "center", wrapText: true };
shortlist.getRange(`A5:O${shortlistEnd}`).format = { verticalAlignment: "top", wrapText: true };
shortlist.getRange("A:A").format.columnWidth = 7;
shortlist.getRange("B:B").format.columnWidth = 10;
shortlist.getRange("C:C").format.columnWidth = 28;
shortlist.getRange("D:D").format.columnWidth = 24;
shortlist.getRange("E:E").format.columnWidth = 44;
shortlist.getRange("F:F").format.columnWidth = 23;
shortlist.getRange("G:G").format.columnWidth = 28;
shortlist.getRange("H:H").format.columnWidth = 12;
shortlist.getRange("I:I").format.columnWidth = 42;
shortlist.getRange("J:L").format.columnWidth = 28;
shortlist.getRange("M:M").format.columnWidth = 22;
shortlist.getRange("N:N").format.columnWidth = 22;
shortlist.getRange("O:O").format.columnWidth = 42;
shortlist.getRange("A1:O1").format.rowHeight = 30;
shortlist.getRange("A2:O2").format.rowHeight = 24;
shortlist.getRange("A4:O4").format.rowHeight = 35;
shortlist.getRange(`A5:O${shortlistEnd}`).format.rowHeight = 55;

// Ham veri sadeleştirme
raw.showGridLines = false;
raw.getRange("A1:T1").merge();
raw.getRange("A1").values = [["Apify Google Maps Sonuçları — Sadeleştirilmiş ve Sınıflandırılmış"]];
raw.getRange("A2:T2").merge();
raw.getRange("A2").values = [["Kaynak: dataset_crawler-google-places_2026-07-18_09-16-44-612(1).csv · 98 benzersiz Place ID"]];
const rawHeaders = ["Firma", "Kategori", "Alt kategoriler", "Arama sorgusu", "İlçe", "Mahalle", "Telefon", "Web sitesi", "Adres", "Puan", "Yorum sayısı", "Kalıcı kapalı", "Place ID", "Harita", "Sınıf", "Değerlendirme", "Telefon var", "Web var", "Kapalı flag", "A/B aday flag"];
raw.getRange("A4:T4").values = [rawHeaders];
const rawRows = rows.map((r) => {
  const [status, reason] = classify(r);
  return [str(r.title), str(r.categoryName), cats(r), str(r.searchString), str(r.city), str(r.neighborhood), str(r.phone), str(r.website), str(r.address), num(r.totalScore), num(r.reviewsCount), bool(r.permanentlyClosed) ? "Evet" : "Hayır", str(r.placeId), str(r.url), status, reason, null, null, null, null];
});
raw.getRangeByIndexes(4, 0, rawRows.length, rawHeaders.length).values = rawRows;
const rawEnd = 4 + rawRows.length;
raw.getRange("Q5:T5").formulas = [["=IF(LEN(G5)>0,1,0)", "=IF(LEN(H5)>0,1,0)", "=IF(L5=\"Evet\",1,0)", "=IF(LEFT(O5,1)=\"A\",1,IF(LEFT(O5,1)=\"B\",1,0))"]];
raw.getRange(`Q5:T${rawEnd}`).fillDown();
const rawTable = raw.tables.add(`A4:T${rawEnd}`, true, "HamVeriTable");
rawTable.style = "TableStyleMedium2";
rawTable.showBandedRows = true;
raw.freezePanes.freezeRows(4);
raw.getRange("A1:T1").format = { fill: navy, font: { color: white, bold: true, size: 15 }, verticalAlignment: "center" };
raw.getRange("A2:T2").format = { fill: lightBlue, font: { color: navy, italic: true }, verticalAlignment: "center" };
raw.getRange("A4:T4").format = { fill: blue, font: { color: white, bold: true }, wrapText: true, verticalAlignment: "center" };
raw.getRange(`A5:T${rawEnd}`).format = { verticalAlignment: "top", wrapText: true };
raw.getRange(`J5:J${rawEnd}`).format.numberFormat = "0.0";
raw.getRange(`K5:K${rawEnd}`).format.numberFormat = "#,##0";
raw.getRange(`O5:O${rawEnd}`).conditionalFormats.add("containsText", { text: "A -", format: { fill: green, font: { bold: true } } });
raw.getRange(`O5:O${rawEnd}`).conditionalFormats.add("containsText", { text: "B -", format: { fill: amber, font: { bold: true } } });
raw.getRange(`O5:O${rawEnd}`).conditionalFormats.add("containsText", { text: "C -", format: { fill: lightBlue } });
raw.getRange(`O5:O${rawEnd}`).conditionalFormats.add("containsText", { text: "D -", format: { fill: gray, font: { color: "#666666" } } });
raw.getRange(`Q5:T${rawEnd}`).format.numberFormat = "0";
const rawWidths = [30,20,34,20,13,18,20,30,48,9,12,13,27,30,22,45,11,9,11,13];
rawWidths.forEach((w, i) => raw.getRangeByIndexes(0, i, rawEnd, 1).format.columnWidth = w);
raw.getRange("A1:T1").format.rowHeight = 30;
raw.getRange("A2:T2").format.rowHeight = 24;
raw.getRange("A4:T4").format.rowHeight = 34;
raw.getRange(`A5:T${rawEnd}`).format.rowHeight = 42;

// Özet
summary.showGridLines = false;
summary.getRange("A1:H1").merge();
summary.getRange("A1").values = [["Adana Kitap Toptancıları — Araştırma Özeti"]];
summary.getRange("A2:H2").merge();
summary.getRange("A2").values = [["Apify çıktısı temizlendi, web kaynaklarıyla desteklendi ve aranma önceliğine göre sınıflandırıldı."]];
summary.getRange("A4:A12").values = [["Apify satırı"], ["Benzersiz Place ID"], ["Telefonu olan kayıt"], ["Web sitesi olan kayıt"], ["Kalıcı kapalı"], ["CSV'deki A/B aday"], ["Öncelikli listedeki firma/grup"], ["Web araştırmasıyla eklenen"], ["CSV'deki farklı arama sorgusu"]];
summary.getRange("B4:B12").formulas = [
  [`=COUNTA('Ham Veri'!A5:A${rawEnd})`],
  [`=COUNTA('Ham Veri'!M5:M${rawEnd})`],
  [`=SUM('Ham Veri'!Q5:Q${rawEnd})`],
  [`=SUM('Ham Veri'!R5:R${rawEnd})`],
  [`=SUM('Ham Veri'!S5:S${rawEnd})`],
  [`=SUM('Ham Veri'!T5:T${rawEnd})`],
  [`=COUNTA('Öncelikli Adaylar'!C5:C${shortlistEnd})`],
  [`=COUNTIF('Öncelikli Adaylar'!M5:M${shortlistEnd},"Web araştırması")`],
  [`=COUNTA(A26:A33)`]
];
summary.getRange("D4:H4").merge();
summary.getRange("D4").values = [["En önemli bulgu"]];
summary.getRange("D5:H8").merge();
summary.getRange("D5").values = [["Google Maps CSV'si Yıldırım Dağıtım, TEMA Yayın Dağıtım, Adarak ve Dörtler gibi güçlü adayları kaçırmış. Bu nedenle yalnız Maps sonuçlarına dayanmak eksik liste üretirdi."]];
summary.getRange("D10:H10").merge();
summary.getRange("D10").values = [["Önerilen arama sırası"]];
summary.getRange("D11:H14").merge();
summary.getRange("D11").values = [["Önce A grubunu ara. Her firmaya: temsil edilen yayınevleri, bayi açılışı, iskonto, minimum sipariş, iade/değişim, vade ve Ceyhan teslimat günlerini sor. Ardından B grubunda kitap kapsamını teyit et."]];
summary.getRange("A16:F16").values = [["Sıra", "Öncelik", "İlk aranacak firma", "Telefon", "İlçe", "Kısa amaç"]];
for (let i = 0; i < 6; i++) {
  const sr = 5 + i;
  const rr = 17 + i;
  summary.getRange(`A${rr}:F${rr}`).formulas = [[
    `='Öncelikli Adaylar'!A${sr}`,
    `='Öncelikli Adaylar'!B${sr}`,
    `='Öncelikli Adaylar'!C${sr}`,
    `='Öncelikli Adaylar'!F${sr}`,
    `='Öncelikli Adaylar'!H${sr}`,
    `='Öncelikli Adaylar'!O${sr}`
  ]];
}
summary.getRange("A25:B25").values = [["CSV'deki arama sorgusu", "Kayıt"]];
summary.getRange("A26:B33").values = [
  ["kitap dağıtım", 20], ["yayın dağıtım", 20], ["kitap toptancısı", 17], ["eğitim yayınları", 13],
  ["yayınevi", 10], ["ders kitapları", 10], ["kırtasiye toptancısı", 4], ["kitap deposu", 4]
];
summary.getRange("A1:H1").format = { fill: navy, font: { color: white, bold: true, size: 17 }, verticalAlignment: "center" };
summary.getRange("A2:H2").format = { fill: lightBlue, font: { color: navy, italic: true }, verticalAlignment: "center" };
summary.getRange("A4:B12").format = { fill: pale, borders: { preset: "outside", style: "thin", color: "#B4C6E7" }, verticalAlignment: "center" };
summary.getRange("A4:A12").format.font = { bold: true, color: navy };
summary.getRange("B4:B12").format = { fill: white, font: { bold: true, color: blue, size: 13 }, horizontalAlignment: "right", numberFormat: "#,##0" };
summary.getRange("D4:H4").format = { fill: blue, font: { color: white, bold: true, size: 12 }, verticalAlignment: "center" };
summary.getRange("D5:H8").format = { fill: amber, font: { color: "#7F6000", bold: true }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: "#D6B656" } };
summary.getRange("D10:H10").format = { fill: blue, font: { color: white, bold: true, size: 12 }, verticalAlignment: "center" };
summary.getRange("D11:H14").format = { fill: green, font: { color: "#274E13" }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: "#93C47D" } };
summary.getRange("A16:F16").format = { fill: blue, font: { color: white, bold: true }, wrapText: true, verticalAlignment: "center" };
summary.getRange("A17:F22").format = { fill: white, wrapText: true, verticalAlignment: "top", borders: { insideHorizontal: { style: "thin", color: "#D9E2F3" }, bottom: { style: "thin", color: "#B4C6E7" } } };
summary.getRange("A25:B25").format = { fill: blue, font: { color: white, bold: true }, verticalAlignment: "center" };
summary.getRange("A26:B33").format = { fill: pale, borders: { insideHorizontal: { style: "thin", color: "#D9E2F3" } } };
summary.getRange("B26:B33").format.numberFormat = "#,##0";
summary.getRange("A1:H1").format.rowHeight = 32;
summary.getRange("A2:H2").format.rowHeight = 24;
summary.getRange("D5:H8").format.rowHeight = 26;
summary.getRange("D11:H14").format.rowHeight = 25;
summary.getRange("A16:F16").format.rowHeight = 30;
summary.getRange("A17:F22").format.rowHeight = 48;
summary.getRange("A:A").format.columnWidth = 25;
summary.getRange("B:B").format.columnWidth = 14;
summary.getRange("C:C").format.columnWidth = 30;
summary.getRange("D:D").format.columnWidth = 30;
summary.getRange("E:E").format.columnWidth = 24;
summary.getRange("F:F").format.columnWidth = 42;
summary.getRange("G:H").format.columnWidth = 14;
summary.freezePanes.freezeRows(2);

await fs.mkdir(outputDir, { recursive: true });

const summaryInspect = await workbook.inspect({ kind: "table", range: "Özet!A1:H33", include: "values,formulas", tableMaxRows: 35, tableMaxCols: 8, maxChars: 10000 });
console.log("SUMMARY_INSPECT");
console.log(summaryInspect.ndjson);

const errorScan = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "final formula error scan" });
console.log("ERROR_SCAN");
console.log(errorScan.ndjson);

for (const [sheetName, fileName, range] of [
  ["Özet", "preview_ozet.png", "A1:H33"],
  ["Öncelikli Adaylar", "preview_adaylar.png", `A1:O${shortlistEnd}`],
  ["Ham Veri", "preview_ham.png", "A1:T24"]
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(`${outputDir}/${fileName}`, new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputXlsx);
console.log(JSON.stringify({ outputXlsx, rawRows: rows.length, shortlistRows: candidates.length, rawEnd, shortlistEnd }));
