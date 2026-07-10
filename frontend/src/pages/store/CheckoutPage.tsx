import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { ModalShell } from "@/components/store/ModalShell";
import { formatTL } from "@/lib/money";
import { isSelected } from "@/lib/cart";
import { estimateDelivery } from "@/lib/delivery";
import { promiseDayLabel } from "@/lib/deliveryPromise";
import { useDeliveryInfo } from "@/hooks/useDelivery";
import { getLegalDoc, OPERATOR } from "@/lib/legalContent";
import { validateCart } from "@/api/store";
import { useCreateOrder } from "@/hooks/useStore";
import { useMyAddresses, useAddAddress } from "@/hooks/useAddresses";
import { AddressForm } from "@/components/address/AddressForm";
import { useCartStore } from "@/store/cartStore";
import { toast } from "@/store/toastStore";

export default function CheckoutPage() {
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const removeSelected = useCartStore((s) => s.removeSelected);
  const couponCode = useCartStore((s) => s.couponCode);
  const setCoupon = useCartStore((s) => s.setCoupon);
  const [couponInput, setCouponInput] = useState(couponCode ?? "");
  const [consent, setConsent] = useState(false);
  const [pickupInfo, setPickupInfo] = useState(false);

  const selectedItems = useMemo(() => items.filter(isSelected), [items]);
  const cartLines = useMemo(
    () => selectedItems.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
    [selectedItems]
  );

  const { data: validation, isLoading } = useQuery({
    queryKey: ["store", "cart", "validate", cartLines, couponCode],
    queryFn: () => validateCart(cartLines, couponCode),
    enabled: cartLines.length > 0,
  });

  const discount = Number(validation?.discount ?? 0);
  const couponError = validation?.coupon_error ?? null;

  const { data: addresses } = useMyAddresses();
  const [addressId, setAddressId] = useState<number | undefined>(undefined);
  const createOrder = useCreateOrder();

  const hasPhysical = validation?.has_physical ?? false;
  const defaultAddr = addresses?.find((a) => a.is_default) ?? addresses?.[0];
  const selectedAddr = addressId ?? defaultAddr?.id;

  if (selectedItems.length === 0) {
    return (
      <StoreLayout title="Ödeme" minimalHeader>
        <div className="mx-auto max-w-md py-20 text-center">
          <p className="text-slate-600 dark:text-slate-300">Sepetinde seçili ürün yok.</p>
          <Link to={ROUTES.storeCart} className="mt-4 inline-block text-sm font-medium underline">
            Sepete dön
          </Link>
        </div>
      </StoreLayout>
    );
  }

  function placeOrder() {
    if (!consent) {
      toast.error("Sözleşmeleri onaylamalısın.");
      return;
    }
    if (validation?.issues && validation.issues.length > 0) {
      toast.error("Sepette sorunlar var, lütfen kontrol et.");
      return;
    }
    if (hasPhysical && !selectedAddr) {
      toast.error("Teslimat adresi seç.");
      return;
    }
    if (couponError) {
      toast.error("Kupon geçersiz, kaldır veya düzelt.");
      return;
    }
    createOrder.mutate(
      {
        items: cartLines,
        address_id: hasPhysical ? selectedAddr : undefined,
        coupon_code: couponCode || undefined,
      },
      {
        onSuccess: (order) => {
          if (order.redirect_url) {
            window.location.href = order.redirect_url; // iyzico hosted checkout (3DS)
            return;
          }
          removeSelected();
          toast.success("Siparişin alındı!");
          navigate(ROUTES.orders);
        },
        onError: (err: unknown) => {
          const detail =
            (err as { response?: { data?: { detail?: string } } })?.response?.data
              ?.detail ?? "Sipariş oluşturulamadı";
          toast.error(detail);
        },
      }
    );
  }

  const itemCount = selectedItems.reduce((s, i) => s + i.quantity, 0);
  const shippingFree = validation ? Number(validation.shipping_fee) === 0 : false;

  return (
    <StoreLayout title="Ödeme" minimalHeader>
      <Seo title="Ödeme — Mağaza" noindex />
      <div className="mx-auto max-w-[1464px] px-4 py-6 md:px-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          {/* ── SOL KOLON ── */}
          <div className="space-y-5">
            {/* Sepetimdeki ürünler (katlanır) */}
            <CartItemsSection itemCount={itemCount} selectedItems={selectedItems} />

            {/* Teslimat (yalnız fiziksel ürün varsa) */}
            {hasPhysical && (
              <Section title="Teslimat Adresi">
                <div className="space-y-3">
                  <div className="rounded-xl border-2 border-indigo-500 p-3 dark:border-indigo-400">
                    <div className="flex items-center gap-2 text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full border-[5px] border-indigo-600 dark:border-indigo-400" />
                      Adrese teslim edilsin
                    </div>
                    <div className="mt-3 pl-6">
                      {addresses && addresses.length > 0 ? (
                        <div className="space-y-2">
                          {addresses.map((a) => (
                            <label
                              key={a.id}
                              className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${
                                selectedAddr === a.id
                                  ? "border-indigo-500 bg-indigo-50/50 dark:border-indigo-400 dark:bg-indigo-500/10"
                                  : "border-slate-200 dark:border-slate-700"
                              }`}
                            >
                              <input
                                type="radio"
                                name="address"
                                checked={selectedAddr === a.id}
                                onChange={() => setAddressId(a.id)}
                                className="mt-1 accent-indigo-600"
                              />
                              <div>
                                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{a.title}</p>
                                {(a.recipient_name || a.phone) && (
                                  <p className="text-sm text-slate-600 dark:text-slate-300">
                                    {[a.recipient_name, a.phone].filter(Boolean).join(" · ")}
                                  </p>
                                )}
                                <p className="text-sm text-slate-500 dark:text-slate-400">{a.address_line}</p>
                              </div>
                            </label>
                          ))}
                          <Link
                            to={ROUTES.addresses}
                            className="inline-block pt-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            Adreslerimi yönet →
                          </Link>
                        </div>
                      ) : (
                        <NewAddressForm onCreated={(id) => setAddressId(id)} />
                      )}
                    </div>
                  </div>

                  {/* Gel Al Noktası — yakında */}
                  <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 opacity-70 dark:border-slate-700">
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                      <span className="h-4 w-4 rounded-full border border-slate-300 dark:border-slate-600" />
                      <span className="font-medium">Gel Al Noktası</span>
                      <button
                        type="button"
                        onClick={() => setPickupInfo(true)}
                        className="text-xs text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                      >
                        Nedir?
                      </button>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                      Yakında
                    </span>
                  </div>
                </div>
              </Section>
            )}

            {/* Sözleşmeler ve Formlar */}
            <Section title="Sözleşmeler ve Formlar">
              <div className="space-y-3">
                <Collapsible title="Ön Bilgilendirme Formu">
                  {validation && (
                    <PreInfoForm validation={validation} hasPhysical={hasPhysical} />
                  )}
                </Collapsible>
                <Collapsible title="Mesafeli Satış Sözleşmesi">
                  <LegalPreview docId="distance-sales" />
                  <Link
                    to={ROUTES.distanceSales}
                    target="_blank"
                    className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Tümünü oku →
                  </Link>
                </Collapsible>
              </div>
            </Section>
          </div>

          {/* ── SAĞ KOLON (sticky) ── */}
          <aside className="h-fit space-y-3 lg:sticky lg:top-24">
            <div className="flex items-center justify-end gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              SSL ile güvenli ödeme
            </div>

            <div className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">Sipariş Özeti</h2>

              {isLoading || !validation ? (
                <p className="mt-4 text-sm text-slate-400">Hesaplanıyor…</p>
              ) : (
                <>
                  <div className="mt-4 space-y-2.5 text-sm">
                    <Row label="Ara toplam" value={formatTL(validation.subtotal)} />
                    {discount > 0 && (
                      <Row
                        label={`İndirim${validation.coupon_code ? ` (${validation.coupon_code})` : ""}`}
                        value={`−${formatTL(validation.discount)}`}
                        accent="emerald"
                      />
                    )}
                    {hasPhysical && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Kargo Tutarı</span>
                        <span className="flex items-center gap-2">
                          {shippingFree ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                              Bedava
                            </span>
                          ) : (
                            <span className="font-medium text-slate-900 dark:text-white">
                              {formatTL(validation.shipping_fee)}
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-700">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">Toplam</span>
                      <span className="text-xl font-semibold text-indigo-600 dark:text-indigo-400">
                        {formatTL(validation.total)}
                      </span>
                    </div>
                  </div>

                  {validation.issues.length > 0 && (
                    <ul className="mt-3 space-y-1 rounded-lg bg-rose-50 p-3 text-xs text-rose-600 dark:bg-rose-500/10">
                      {validation.issues.map((iss, i) => (
                        <li key={i}>• {iss}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {/* Kupon */}
              <CouponBox
                couponCode={couponCode}
                couponError={couponError}
                couponInput={couponInput}
                setCouponInput={setCouponInput}
                onApply={() => setCoupon(couponInput.trim())}
                onClear={() => {
                  setCoupon(null);
                  setCouponInput("");
                }}
              />

              {/* Onay kutusu */}
              <label className="mt-4 flex items-start gap-2.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700"
                />
                <span>
                  <Link to={ROUTES.distanceSales} target="_blank" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    Ön Bilgilendirme Koşulları
                  </Link>
                  'nı ve{" "}
                  <Link to={ROUTES.distanceSales} target="_blank" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    Mesafeli Satış Sözleşmesi
                  </Link>
                  'ni okudum, onaylıyorum.
                </span>
              </label>

              <button
                type="button"
                onClick={placeOrder}
                disabled={!consent || createOrder.isPending || isLoading || !!couponError}
                className="mt-4 w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-500"
              >
                {createOrder.isPending ? "İşleniyor…" : "Ödeme Yap"}
              </button>

              <p className="mt-2.5 text-center text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                iyzico ile güvenli ödeme. Kart bilgilerin bir sonraki güvenli adımda alınır; biz saklamayız.
              </p>
            </div>
          </aside>
        </div>
      </div>

      {pickupInfo && (
        <ModalShell title="Gel Al Noktası" onClose={() => setPickupInfo(false)}>
          <div className="space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <p>
              Gel al noktası, siparişini kargo yerine sana yakın bir
              <span className="font-medium text-slate-900 dark:text-white"> kütüphane / etüt merkezinden</span>{" "}
              teslim alabildiğin noktadır.
            </p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              Bu seçenek <span className="font-medium">yakında</span> aktif olacak. Şimdilik siparişler
              adrese kargoyla teslim edilir.
            </p>
          </div>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setPickupInfo(false)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              Anladım
            </button>
          </div>
        </ModalShell>
      )}
    </StoreLayout>
  );
}

/* ── Yardımcı bileşenler ── */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
      <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: "emerald" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span
        className={
          accent === "emerald"
            ? "font-medium text-emerald-600 dark:text-emerald-400"
            : "font-medium text-slate-900 dark:text-white"
        }
      >
        {value}
      </span>
    </div>
  );
}

function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-800 dark:text-slate-200"
      >
        {title}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="border-t border-slate-100 p-4 dark:border-slate-700">{children}</div>}
    </div>
  );
}

function CartItemsSection({
  itemCount,
  selectedItems,
}: {
  itemCount: number;
  selectedItems: ReturnType<typeof useCartStore.getState>["items"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between"
      >
        <span className="text-base font-semibold text-slate-900 dark:text-white">
          Sepetimdeki Ürünler ({itemCount})
        </span>
        <span className="flex items-center gap-2">
          {!open && (
            <span className="flex -space-x-2">
              {selectedItems.slice(0, 4).map((i) => (
                <span
                  key={i.product_id}
                  className="h-9 w-9 overflow-hidden rounded-full border-2 border-white bg-slate-100 dark:border-slate-900 dark:bg-slate-800"
                >
                  {i.cover_url && <img src={i.cover_url} alt="" className="h-full w-full object-cover" />}
                </span>
              ))}
            </span>
          )}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {selectedItems.map((i) => (
            <div key={i.product_id} className="flex items-center gap-3 py-3">
              <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                {i.cover_url && <img src={i.cover_url} alt="" className="h-full w-full object-cover" />}
              </div>
              <span className="line-clamp-2 flex-1 text-sm text-slate-700 dark:text-slate-300">
                {i.title}
              </span>
              <span className="text-sm text-slate-400">×{i.quantity}</span>
              <span className="w-24 text-right text-sm font-semibold text-slate-900 dark:text-white">
                {formatTL(Number(i.price) * i.quantity)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PreInfoForm({
  validation,
  hasPhysical,
}: {
  validation: import("@/types").CartValidateOut;
  hasPhysical: boolean;
}) {
  const { data: deliveryInfo } = useDeliveryInfo(hasPhysical);
  const fact = "flex justify-between gap-4 py-1.5 text-xs";
  return (
    <div className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
      <dl className="divide-y divide-slate-100 dark:divide-slate-800">
        <div className={fact}>
          <dt className="text-slate-400">Satıcı</dt>
          <dd className="text-right font-medium text-slate-700 dark:text-slate-200">{OPERATOR.entity}</dd>
        </div>
        <div className="py-1.5">
          <dt className="text-slate-400">Sipariş konusu</dt>
          <dd className="mt-1 space-y-0.5">
            {validation.items.map((it) => (
              <div key={it.id} className="flex justify-between gap-4">
                <span className="text-slate-600 dark:text-slate-300">
                  {it.title} × {it.quantity}
                </span>
                <span className="shrink-0 text-slate-500">
                  {formatTL(Number(it.unit_price) * it.quantity)}
                </span>
              </div>
            ))}
          </dd>
        </div>
        <div className={fact}>
          <dt className="text-slate-400">Ara toplam</dt>
          <dd className="font-medium text-slate-700 dark:text-slate-200">{formatTL(validation.subtotal)}</dd>
        </div>
        {Number(validation.discount) > 0 && (
          <div className={fact}>
            <dt className="text-slate-400">İndirim</dt>
            <dd className="font-medium text-emerald-600 dark:text-emerald-400">−{formatTL(validation.discount)}</dd>
          </div>
        )}
        {hasPhysical && (
          <div className={fact}>
            <dt className="text-slate-400">Kargo</dt>
            <dd className="font-medium text-slate-700 dark:text-slate-200">
              {Number(validation.shipping_fee) === 0 ? "Ücretsiz" : formatTL(validation.shipping_fee)}
            </dd>
          </div>
        )}
        <div className={fact}>
          <dt className="text-slate-400">Toplam</dt>
          <dd className="font-semibold text-slate-900 dark:text-white">{formatTL(validation.total)}</dd>
        </div>
        <div className={fact}>
          <dt className="text-slate-400">Ödeme aracı</dt>
          <dd className="font-medium text-slate-700 dark:text-slate-200">iyzico (kredi/banka kartı)</dd>
        </div>
        <div className={fact}>
          <dt className="text-slate-400">Teslimat</dt>
          <dd className="text-right font-medium text-slate-700 dark:text-slate-200">
            {hasPhysical
              ? deliveryInfo
                ? `Cıncık Teslimat · ${promiseDayLabel(deliveryInfo.promised_date_now)} kapında`
                : `Adrese teslimat · tahmini ${estimateDelivery("PHYSICAL")}`
              : "Dijital — ödeme onayında anında erişim"}
          </dd>
        </div>
        <div className="py-1.5">
          <dt className="text-slate-400">Cayma hakkı</dt>
          <dd className="mt-1 text-slate-600 dark:text-slate-300">
            {hasPhysical
              ? "Fiziksel ürünlerde teslimden itibaren 14 gün içinde cayma hakkı; dijital içeriklerde erişim sonrası cayma istisnası geçerlidir."
              : "Dijital içeriklerde erişim sağlandıktan sonra cayma hakkı kullanılamaz (Mesafeli Sözleşmeler Yönetmeliği m.15/1-ğ)."}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-slate-400">
        İade ve şikayet için{" "}
        <Link to={ROUTES.refundPolicy} target="_blank" className="text-indigo-600 hover:underline dark:text-indigo-400">
          İptal ve İade Politikası
        </Link>{" "}
        · {OPERATOR.email}
      </p>
    </div>
  );
}

function LegalPreview({ docId }: { docId: "distance-sales" }) {
  const doc = getLegalDoc(docId);
  return (
    <div className="max-h-60 overflow-y-auto rounded-lg bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
      {doc.sections.slice(0, 4).map((s) => (
        <div key={s.id} className="mb-3 last:mb-0">
          <p className="font-semibold text-slate-700 dark:text-slate-200">{s.heading}</p>
          {s.blocks.map((b, i) =>
            b.type === "p" ? (
              <p key={i} className="mt-1">
                {b.text}
              </p>
            ) : (
              <ul key={i} className="mt-1 list-disc space-y-0.5 pl-4">
                {b.items.map((it, j) => (
                  <li key={j}>{it}</li>
                ))}
              </ul>
            )
          )}
        </div>
      ))}
    </div>
  );
}

function CouponBox({
  couponCode,
  couponError,
  couponInput,
  setCouponInput,
  onApply,
  onClear,
}: {
  couponCode: string | null;
  couponError: string | null;
  couponInput: string;
  setCouponInput: (v: string) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(!!couponCode);
  return (
    <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-700">
      {couponCode && !couponError ? (
        <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-500/10">
          <span className="font-medium text-emerald-700 dark:text-emerald-400">{couponCode} uygulandı</span>
          <button type="button" onClick={onClear} className="text-xs font-medium text-slate-500 hover:text-rose-600">
            Kaldır
          </button>
        </div>
      ) : open ? (
        <>
          <div className="flex gap-2">
            <input
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
              placeholder="Kupon kodu"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <button
              type="button"
              disabled={!couponInput.trim()}
              onClick={onApply}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              Uygula
            </button>
          </div>
          {couponError && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{couponError}</p>}
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          İndirim kodu kullan
        </button>
      )}
    </div>
  );
}

/** Kayıtlı adres yokken checkout içinde tam adres formu — ortak AddressForm
 *  (haritadan konum, il/ilçe, alıcı adı + telefon; teslimat bölgesi kontrolü
 *  pin'den beslendiği için konum burada da seçilebilmeli). */
function NewAddressForm({ onCreated }: { onCreated: (id: number) => void }) {
  const add = useAddAddress();

  return (
    <div className="rounded-xl border border-slate-200 p-1 dark:border-slate-700">
      <p className="px-3 pt-3 text-sm text-slate-500">Kayıtlı adresin yok. Yeni ekle:</p>
      <AddressForm
        pending={add.isPending}
        submitLabel="Adresi kaydet"
        hideDefaultToggle
        onCancel={() => {}}
        onSubmit={(payload) =>
          add.mutate(
            { ...payload, is_default: true },
            {
              onSuccess: (created) => {
                onCreated(created.id);
                toast.success("Adres eklendi");
              },
              onError: () => toast.error("Adres kaydedilemedi"),
            }
          )
        }
      />
    </div>
  );
}
