// Kamera fotoğrafını yükleme öncesi küçültür (canvas re-encode).
//
// Neden: mobil kameralar 3-8 MB çıktı verir; sahada 3G/kenar bölgede bu yükleme
// 20-60 sn sürer ve kurye kapıda bekler. Teslim kanıtı için 1600px uzun kenar +
// 0.8 JPEG fazlasıyla yeterlidir (~200-500 KB).
//
// Dayanıklılık: herhangi bir adım desteklenmiyorsa/başarısızsa ORİJİNAL dosya
// döner — sıkıştırma bir iyileştirmedir, teslim akışını asla bloklamaz.
const MAX_EDGE = 1600;
const QUALITY = 0.8;

export async function compressImage(file: File): Promise<File> {
  // Görsel değilse ya da zaten küçükse dokunma.
  if (!file.type.startsWith("image/") || file.size < 400 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1024 * 1024) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY)
    );
    // Sıkıştırma büyüttüyse (nadir: zaten optimize edilmiş görsel) orijinali koru.
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}
