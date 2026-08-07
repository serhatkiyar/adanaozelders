import AdminHome, { type Tab } from "@/pages/dashboards/AdminHome";

// Prop tipi artık `Tab`'in TAMAMI. Eskiden `Exclude<Tab, "overview">` idi ve
// tam da bu dışlama, `AdminHome`'un "overview" dalını (eğitmen onay kuyruğunu)
// ULAŞILAMAZ kılıyordu — P1-1. Dal silindiği için dışlamanın konusu kalmadı;
// dışlamayı tutmak, ileride eklenecek bir bölümü aynı biçimde sessizce
// ölü bırakmanın kapısını açık tutardı.
export default function AdminSectionPage({ section }: { section: Tab }) {
  return <AdminHome section={section} />;
}
