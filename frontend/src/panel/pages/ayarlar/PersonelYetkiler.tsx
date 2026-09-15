// Personel & Yetkiler — eski AdminAccessPage (yönetici rolleri, izinler, atamalar) panel düzeninde.
// Veri useAdminPermissions/useAdminRoles/useAdminRoleAssignments; kesin izin kontrolü backend'de.
import { useRef, useState, type ReactNode } from "react";
import { App, Button, Flex, Select, Tag, Typography, theme } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { RolCekmecesi } from "@/panel/pages/ayarlar/RolCekmecesi";
import { useAdminPermissions, useAdminRoleAssignments, useAdminRoles, useAssignAdminRole } from "@/hooks/useAdmin";
import { getErrorDetail } from "@/lib/errors";
import type { AdminRoleOut } from "@/types";

// Ölçülen ikas bölümü: beyaz, ince colorBorderSecondary, radius 4; başlık 18/500 + ince ayraç.
function Bolum({ baslik, aciklama, ekstra, children }: { baslik: string; aciklama?: ReactNode; ekstra?: ReactNode; children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <section aria-label={baslik} style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4 }}>
      <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "16px 24px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <div>
          <Typography.Text style={{ fontSize: 18, fontWeight: 500, lineHeight: "28px", display: "block" }}>{baslik}</Typography.Text>
          {aciklama ? <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>{aciklama}</Typography.Text> : null}
        </div>
        {ekstra}
      </Flex>
      <div style={{ padding: 24 }}>{children}</div>
    </section>
  );
}

type Cekmece = { acik: false } | { acik: true; rol: AdminRoleOut | null };

export function PersonelYetkiler() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { canView, canManage } = useAdminAreaAccess("admin_roles");
  const izinler = useAdminPermissions(canView);
  const roller = useAdminRoles(canView);
  const atamalar = useAdminRoleAssignments(canView);
  const ata = useAssignAdminRole();
  const [cekmece, setCekmece] = useState<Cekmece>({ acik: false });
  // Satır bazlı senkron kilit: aynı yönetici için aynı tick'te ikinci istek yok, diğer satırlar serbest.
  const bekleyenRef = useRef(new Set<number>());
  const [bekleyenler, setBekleyenler] = useState<number[]>([]);

  // mutateAsync: her satırın kendi sözü var; tek gözlemcinin geri çağrıları ezmesi (kilit sızıntısı) olmaz.
  const rolDegistir = async (adminId: number, roleId: number) => {
    if (bekleyenRef.current.has(adminId)) return;
    bekleyenRef.current.add(adminId);
    setBekleyenler((o) => [...o, adminId]);
    try {
      await ata.mutateAsync({ adminId, roleId });
      message.success("Yönetici rolü atandı.");
    } catch (e) {
      // 403/409 (son Super Admin) dahil gerçek sunucu mesajı; seçim veriden geldiği için mevcut değere döner.
      message.error(getErrorDetail(e, "Rol atanamadı."));
    } finally {
      bekleyenRef.current.delete(adminId);
      setBekleyenler((o) => o.filter((id) => id !== adminId));
    }
  };

  if (!canView) return <AccessDenied area="Personel & Yetkiler" />;

  const yukleniyor = izinler.isPending || roller.isPending || atamalar.isPending;
  const hata = izinler.error ?? roller.error ?? atamalar.error;
  const yenidenDene = () => {
    void izinler.refetch();
    void roller.refetch();
    void atamalar.refetch();
  };

  const rolListesi = roller.data ?? [];
  const rolSecenekleri = rolListesi.map((r) => ({ value: r.id, label: r.name }));
  const kartStil = { border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4, padding: 16 };

  return (
    <Flex vertical gap={24}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Personel & Yetkiler</Typography.Title>
        {canManage && !yukleniyor && !hata ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCekmece({ acik: true, rol: null })}>Yeni rol</Button>
        ) : null}
      </Flex>
      {!canManage ? (
        <Typography.Text type="secondary">Bu alanda yalnız görüntüleme yetkiniz var; rol oluşturma, düzenleme ve atama için admin_roles.manage izni gerekir.</Typography.Text>
      ) : null}

      {yukleniyor ? (
        <YukleniyorDurumu etiket="Yetki bilgileri yükleniyor…" />
      ) : hata ? (
        <HataDurumu hata={getErrorDetail(hata, "Yetki bilgileri yüklenemedi.")} hataAksiyon={<Button size="small" onClick={yenidenDene}>Tekrar dene</Button>} />
      ) : (
        <>
          <Bolum baslik="Yönetici rolleri" aciklama="Her yönetici tek bir görev rolüne atanır. Kesin izin kontrolü API tarafında uygulanır.">
            {rolListesi.length === 0 ? (
              <BosDurumu baslik="Tanımlı rol yok" aciklama="Henüz yönetici rolü oluşturulmamış." />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
                {rolListesi.map((rol) => (
                  <article key={rol.id} aria-label={rol.name} style={kartStil}>
                    <Flex align="flex-start" justify="space-between" gap={12}>
                      <div style={{ minWidth: 0 }}>
                        <Flex align="center" gap={8} wrap>
                          <Typography.Text style={{ fontWeight: 500 }}>{rol.name}</Typography.Text>
                          {rol.is_system ? <Tag color="blue" style={{ marginInlineEnd: 0 }}>Sistem</Tag> : null}
                        </Flex>
                        <Typography.Text style={{ fontFamily: "monospace", fontSize: 12, color: token.colorTextTertiary, display: "block", marginTop: 2 }}>{rol.code}</Typography.Text>
                      </div>
                      {/* SUPER_ADMIN düzenlenemez (eski ekran kuralı). */}
                      {canManage && rol.code !== "SUPER_ADMIN" ? (
                        <Button size="small" aria-label={`${rol.name} rolünü düzenle`} onClick={() => setCekmece({ acik: true, rol })}>Düzenle</Button>
                      ) : null}
                    </Flex>
                    {rol.description ? <Typography.Text type="secondary" style={{ display: "block", marginTop: 12 }}>{rol.description}</Typography.Text> : null}
                    <Flex gap={8} wrap style={{ marginTop: 12 }}>
                      <Tag style={{ marginInlineEnd: 0 }}>{rol.permission_codes.length} izin</Tag>
                      <Tag style={{ marginInlineEnd: 0 }}>{rol.assignment_count} yönetici</Tag>
                    </Flex>
                  </article>
                ))}
              </div>
            )}
          </Bolum>

          <Bolum baslik="Yönetici atamaları" aciklama="Son Super Admin başka bir role indirilemez.">
            {(atamalar.data ?? []).length === 0 ? (
              <BosDurumu baslik="Yönetici bulunamadı" aciklama="Sunucu hiçbir yönetici hesabı bildirmedi." />
            ) : (
              (atamalar.data ?? []).map((atama, i, dizi) => (
                <Flex
                  key={atama.admin_id}
                  align="center"
                  justify="space-between"
                  gap={12}
                  wrap
                  style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${token.colorBorderSecondary}` }}
                >
                  <div style={{ minWidth: 0 }}>
                    <Typography.Text style={{ fontWeight: 500, display: "block" }}>{atama.admin_name}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{atama.admin_email}</Typography.Text>
                  </div>
                  {canManage ? (
                    <Select<number>
                      aria-label={`${atama.admin_name} için yönetici rolü`}
                      value={atama.role_id ?? undefined}
                      placeholder="Rol seçin"
                      options={rolSecenekleri}
                      loading={bekleyenler.includes(atama.admin_id)}
                      disabled={bekleyenler.includes(atama.admin_id)}
                      onChange={(v) => void rolDegistir(atama.admin_id, v)}
                      style={{ width: 288 }}
                    />
                  ) : (
                    <Typography.Text>{atama.role_name ?? <Typography.Text type="secondary">Rol atanmamış</Typography.Text>}</Typography.Text>
                  )}
                </Flex>
              ))
            )}
          </Bolum>
        </>
      )}

      <RolCekmecesi
        acik={cekmece.acik}
        rol={cekmece.acik ? cekmece.rol : null}
        izinler={izinler.data}
        kapat={() => setCekmece({ acik: false })}
      />
    </Flex>
  );
}
