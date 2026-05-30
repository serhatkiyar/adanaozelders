// Sınav -> ders taksonomisi. Yaprak `q`, mevcut full-text aramayı tetikleyen
// ders terimidir (sınav adı yalnız gruplama içindir, backend metinde aranmaz).
export interface SubjectLeaf {
  label: string;
  q: string;
}

export interface ExamColumn {
  title?: string; // alt grup başlığı (ör. "Lisans"); yoksa tek liste
  items: SubjectLeaf[];
}

export interface ExamCategory {
  label: string; // TYT, AYT, KPSS...
  columns: ExamColumn[];
}

// Ortak ders terimleri (tekrarları tek yerden yönetmek için).
const leaf = (label: string, q: string = label): SubjectLeaf => ({ label, q });

// Tüm sınavlardaki benzersiz dersler (q'ya göre tekilleştirilmiş) — eğitmen
// branş seçimi (TutorSettings) için düz liste.
export function uniqueSubjects(): SubjectLeaf[] {
  const seen = new Set<string>();
  const out: SubjectLeaf[] = [];
  for (const exam of EXAMS)
    for (const col of exam.columns)
      for (const it of col.items)
        if (!seen.has(it.q)) {
          seen.add(it.q);
          out.push(it);
        }
  return out;
}

export const EXAMS: ExamCategory[] = [
  {
    label: "TYT",
    columns: [
      {
        items: [
          leaf("Matematik"),
          leaf("Geometri"),
          leaf("Türkçe"),
          leaf("Fizik"),
          leaf("Kimya"),
          leaf("Biyoloji"),
          leaf("Tarih"),
          leaf("Coğrafya"),
          leaf("Felsefe"),
          leaf("Din Kültürü", "Din"),
        ],
      },
    ],
  },
  {
    label: "AYT",
    columns: [
      {
        items: [
          leaf("Matematik"),
          leaf("Fizik"),
          leaf("Kimya"),
          leaf("Biyoloji"),
          leaf("Edebiyat"),
          leaf("Tarih"),
          leaf("Coğrafya"),
          leaf("Felsefe"),
        ],
      },
    ],
  },
  {
    label: "YDT",
    columns: [
      {
        items: [leaf("İngilizce"), leaf("Almanca"), leaf("Fransızca")],
      },
    ],
  },
  {
    label: "LGS",
    columns: [
      {
        items: [
          leaf("Matematik"),
          leaf("Türkçe"),
          leaf("Fen Bilimleri", "Fen"),
          leaf("T.C. İnkılap Tarihi", "İnkılap"),
          leaf("İngilizce"),
          leaf("Din Kültürü", "Din"),
        ],
      },
    ],
  },
  {
    label: "KPSS",
    columns: [
      {
        title: "Lisans",
        items: [
          leaf("Türkçe"),
          leaf("Matematik"),
          leaf("Tarih"),
          leaf("Coğrafya"),
          leaf("Vatandaşlık"),
          leaf("Eğitim Bilimleri", "Eğitim"),
        ],
      },
      {
        title: "Önlisans",
        items: [
          leaf("Türkçe"),
          leaf("Matematik"),
          leaf("Tarih"),
          leaf("Coğrafya"),
          leaf("Vatandaşlık"),
        ],
      },
      {
        title: "Ortaöğretim",
        items: [
          leaf("Türkçe"),
          leaf("Matematik"),
          leaf("Tarih"),
          leaf("Coğrafya"),
          leaf("Vatandaşlık"),
        ],
      },
    ],
  },
  {
    label: "DGS",
    columns: [
      {
        items: [leaf("Matematik"), leaf("Türkçe")],
      },
    ],
  },
  {
    label: "ALES",
    columns: [
      {
        items: [leaf("Sayısal"), leaf("Sözel")],
      },
    ],
  },
  {
    label: "YDS",
    columns: [
      {
        items: [
          leaf("İngilizce"),
          leaf("Almanca"),
          leaf("Fransızca"),
          leaf("Arapça"),
        ],
      },
    ],
  },
  {
    label: "ÖABT",
    columns: [
      {
        items: [
          leaf("Matematik"),
          leaf("Türkçe"),
          leaf("Fen Bilimleri", "Fen"),
          leaf("Tarih"),
          leaf("Coğrafya"),
          leaf("İngilizce"),
        ],
      },
    ],
  },
  {
    label: "MSÜ",
    columns: [
      {
        items: [
          leaf("Matematik"),
          leaf("Fizik"),
          leaf("Türkçe"),
          leaf("Tarih"),
        ],
      },
    ],
  },
];
