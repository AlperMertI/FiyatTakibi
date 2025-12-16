// price-utils.js
export function parsePrice(input) {
    if (input === null || input === undefined) return NaN;

    // Zaten sayıysa direkt döndür
    if (typeof input === 'number') return input;

    // String ise temizle
    let priceString = input.toString();

    // Eğer nokta var ama virgül yoksa (örn: "123.45" veya "1.599")
    if (priceString.includes('.') && !priceString.includes(',')) {
        // "TL" içeriyorsa bu muhtemelen TR formatıdır
        if (priceString.toUpperCase().includes('TL')) {
            // Aşağıdaki temizleme bloğuna düşmesi için burayı atla
        }
        // 3 ondalık hane varsa (örn: 1.599), bu binlik ayracıdır. TR formatı kabul et.
        else if (priceString.split('.').pop().length === 3) {
            // Aşağıdaki temizleme bloğuna düşmesi için burayı atla
        }
        else {
            // Diğer durumlar (örn: 123.45) -> İngilizce ondalık sayı kabul et
            return parseFloat(priceString);
        }
    }

    // TR Formatı (örn: "1.234,56 TL")
    // Noktaları (binlik ayracı) sil, virgülü noktaya çevir
    const cleanedString = priceString.replace(/\./g, "").replace(",", ".");
    // Sadece rakam ve nokta dışındakileri temizle (TL vb. gider)
    const finalString = cleanedString.replace(/[^\d.]/g, "");

    return parseFloat(finalString);
}

export function timeAgo(dateParam) {
    if (!dateParam) return null;
    const date = typeof dateParam === 'object' ? dateParam : new Date(dateParam);
    if (isNaN(date.getTime())) return null; // Geçersiz tarih kontrolü

    const today = new Date();
    const seconds = Math.round((today - date) / 1000);
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);

    if (seconds < 60) return 'Az önce';
    else if (minutes < 60) return `${minutes} dk önce`;
    else if (hours < 24) return `${hours} sa. önce`;
    else if (days < 30) return `${days} gün önce`;
    else return date.toLocaleDateString("tr-TR");
}