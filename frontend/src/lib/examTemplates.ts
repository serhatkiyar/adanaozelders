// Deneme sınavı şablonları. `max` her dersin soru sayısı (üst sınır / ipucu);
// "Özel" şablonu boş başlar, öğrenci kendi derslerini ekler.

export interface TemplateSubject {
  subject: string;
  max: number;
}

export interface ExamTemplate {
  key: string;
  label: string;
  examType: string; // PracticeExam.exam_type olarak saklanır
  subjects: TemplateSubject[];
}

export const EXAM_TEMPLATES: ExamTemplate[] = [
  {
    key: "tyt",
    label: "TYT",
    examType: "TYT",
    subjects: [
      { subject: "Türkçe", max: 40 },
      { subject: "Matematik", max: 40 },
      { subject: "Sosyal Bilimler", max: 20 },
      { subject: "Fen Bilimleri", max: 20 },
    ],
  },
  {
    key: "ayt-say",
    label: "AYT Sayısal",
    examType: "AYT",
    subjects: [
      { subject: "Matematik", max: 40 },
      { subject: "Fizik", max: 14 },
      { subject: "Kimya", max: 13 },
      { subject: "Biyoloji", max: 13 },
    ],
  },
  {
    key: "ayt-ea",
    label: "AYT Eşit Ağırlık",
    examType: "AYT",
    subjects: [
      { subject: "Matematik", max: 40 },
      { subject: "Edebiyat", max: 24 },
      { subject: "Tarih-1", max: 10 },
      { subject: "Coğrafya-1", max: 6 },
    ],
  },
  {
    key: "ayt-soz",
    label: "AYT Sözel",
    examType: "AYT",
    subjects: [
      { subject: "Edebiyat", max: 24 },
      { subject: "Tarih", max: 21 },
      { subject: "Coğrafya", max: 17 },
      { subject: "Felsefe Grubu", max: 12 },
      { subject: "Din Kültürü", max: 6 },
    ],
  },
  {
    key: "custom",
    label: "Özel (kendim eklerim)",
    examType: "",
    subjects: [],
  },
];
