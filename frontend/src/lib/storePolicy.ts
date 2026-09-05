// Mağaza politikasının vitrinde GÖRÜNEN sayıları.
//
// Tek kaynak olmalarının sebebi somut: schema.org `hasMerchantReturnPolicy`
// markup'ı ile ekrandaki "14 gün içinde" cümlesi AYNI sayıyı taşımak
// zorundadır. Google'ın yapılandırılmış veri politikası, markup'ın sayfada
// görünen veriyle birebir olmasını şart koşar; iki yerde ayrı sabit tutmak,
// birinin geride kalmasıyla sonuçlanır ve o an manuel işlem sebebidir.

/** Fiziksel üründe gerekçesiz cayma hakkı süresi (gün) — MSY m.9. */
export const CAYMA_HAKKI_GUN = 14;
