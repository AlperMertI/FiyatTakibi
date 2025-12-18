// update.js
import { getAllFromSync, saveToDB } from "./storage.js";
import { createTabPromise } from "./background.js";

if (typeof browser === "undefined") {
  var browser = chrome;
}

export function updateLastUpdateTimeElement() {
  browser.storage.sync.get("lastUpdateTime", (data) => {
    if (data.lastUpdateTime) {
      console.log(`Son güncelleme: ${data.lastUpdateTime}`);
    }
  });
}

export async function updateBadgeCount(products) {
  try {
    const discountedProducts = products.filter((product) => product.status === "⬇️" || product.status === "➕");
    const count = discountedProducts.length;
    await browser.action.setBadgeText({ text: count > 0 ? count.toString() : "" });
    await browser.action.setBadgeBackgroundColor({ color: "#E74C3C" });
  } catch (error) {
    console.error("Badge güncellenirken hata oluştu:", error);
  }
}

/**
 * Amazon ürün fiyatını, durumunu ve GÖRSELİNİ çeker.
 * (Bu fonksiyon sizin çalışan kodunuzdan alındı, dokunulmadı)
 */
async function fetchAmazonProductPrice(product, needsImageUpdate) {
  let picUrl = null;
  let name = null;
  const { id, url } = product;

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/5.0 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0",
      },
    });

    if (!response.ok) {
      console.error(`AMZ HTTP error! status: ${response.status} for ID: ${id}`);
      return { price: null, status: "‼️", picUrl: null, name: null };
    }

    const html = await response.text();

    // 1. Ürün Adını Çek
    try {
      const titleRegex = /<span [^>]*id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i;
      const titleMatch = html.match(titleRegex);
      if (titleMatch && titleMatch[1]) {
        name = titleMatch[1].trim();
      }
    } catch (e) {
      console.warn(`AFT (AMZ) Title regex hatası (ID: ${id}): ${e.message}`);
    }

    // 2. Ürün Görselini Çek
    // Eğer görsel yoksa veya güncelleme isteniyorsa çek
    if (!product.picUrl || needsImageUpdate) {
      try {
        const imgTagRegex = /<img [^>]*id=["']landingImage["'][^>]*>/i;
        const imgTagMatch = html.match(imgTagRegex);
        if (imgTagMatch && imgTagMatch[0]) {
          const imgTagHtml = imgTagMatch[0];
          const oldHiresRegex = /data-old-hires=["'](https?:\/\/[^"']+)["']/i;
          let hiresMatch = imgTagHtml.match(oldHiresRegex);
          if (hiresMatch && hiresMatch[1]) {
            picUrl = hiresMatch[1];
          } else {
            const srcRegex = /src=["'](https?:\/\/[^"']+)["']/i;
            let srcMatch = imgTagHtml.match(srcRegex);
            if (srcMatch && srcMatch[1]) {
              picUrl = srcMatch[1];
            }
          }
        }
      } catch (e) {
        console.error(`AFT (AMZ) Resim regex hatası (ID: ${id}): ${e.message}`);
      }

    } else {
      // Zaten görsel var, eskisini koru
      picUrl = product.picUrl;
    }

    // 3. Fiyatı Çek
    let priceString = null;
    const containerIDs = ["corePrice_feature_div", "corePriceDisplay_desktop_feature_div"];
    for (const containerId of containerIDs) {
      const block = html.match(new RegExp(`<div[^>]+id=["']${containerId}["'][^>]*>([\\s\\S]*?)</div>`, "i"))?.[1];
      if (!block) continue;
      const whole = block.match(/a-price-whole[^>]*>([\d.,]+)/)?.[1]?.trim();
      const fraction = block.match(/a-price-fraction[^>]*>(\d+)/)?.[1]?.trim() ?? "00";
      const symbol = block.match(/a-price-symbol[^>]*>([^<]+)/)?.[1]?.trim() ?? "";
      if (whole) {
        priceString = `${whole},${fraction}${symbol}`.trim();
        break;
      }
    }
    if (!priceString) {
      const fallback = html.match(
        /<span[^>]*class=["'][^"']*a-price[^"']*a-size-medium[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["'][^"']*a-offscreen[^"']*["'][^>]*>([^<]+)<\/span>/i
      )?.[1];
      priceString = fallback?.trim() ?? null;
    }

    // 4. Durumu Belirle
    let status = "‼️"; // Varsayılan durum: Hata
    if (priceString) {
      status = "✅"; // Fiyat bulunduysa
    } else {
      // FİYAT BULUNAMADIYSA: Stokta yok olup olmadığını kontrol et

      // Güçlü sinyal olan "outOfStock" div'inin varlığını kontrol et.
      const outOfStockRegex = /<div [^>]*id=["']outOfStock["'][^>]*>/i;

      // Zayıf sinyal: id="availability" div'inin içeriği (fallback)
      const availabilityRegex = /<div [^>]*id="availability"[^>]*>([\s\S]*?)<\/div>/i;
      const availabilityMatch = html.match(availabilityRegex);
      const availabilityText = availabilityMatch ? availabilityMatch[1] : "";

      if (html.match(outOfStockRegex) ||
        availabilityText.includes("Stokta yok") ||
        availabilityText.includes("Tükendi") ||
        availabilityText.includes("Şu anda mevcut değil.")) {
        status = "Stokta Yok";
        priceString = null; // Fiyatın null olduğundan emin ol
      }
    }

    // 5. Sonucu döndür
    if (status === "Stokta Yok") {
      return { price: null, status: "Stokta Yok", picUrl: picUrl, name: name };
    }
    if (status === "✅") {
      return { price: priceString, status: "✅", picUrl: picUrl, name: name };
    }

    // Hata veya fiyat bulunamadı (ama stokta yok da değil)
    return { price: null, status: "‼️", picUrl: picUrl, name: name };

  } catch (error) {
    console.error(`fetchAmazonProductPrice (ID: ${id}) hatası:`, error);
    // Hata olsa bile, bulduğumuz görseli ve adı döndür
    return { price: null, status: "‼️", picUrl: picUrl, name: name };
  }
}

// Yardımcı: Akakçe HTML'inden fiyatı parse et
function parseAkakceHTML(html) {
  try {
    // 1. Önce klasik fiyat wrapper'ına bak
    // <span class="pt_v8">1.234,56 TL</span> veya benzer yapı
    // Genellikle: <span class="pt_v8">...</span> içinde fiyat yazar
    const priceMatch = html.match(/<span[^>]*class=["']pt_v8["'][^>]*>([\s\S]*?)<\/span>/i);
    if (priceMatch && priceMatch[1]) {
      return priceMatch[1].trim();
    }

    // 2. Alternatif: <div class="p-d-v8"><span>...</span></div>
    // Akakçe yapısı bazen değişebilir, en belirgin "pt_v8" class'ıdır (Price Text V8).

    return null;
  } catch (e) { return null; }
}

async function fetchAkakcePrice(product) {
  try {
    const response = await fetch(product.url, {
      method: 'GET',
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/5.0 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
      }
    });

    if (!response.ok) return { price: null, status: "‼️" };

    const html = await response.text();
    const priceStr = parseAkakceHTML(html);

    if (priceStr) {
      return { price: priceStr, status: "✅" };
    } else {
      // Fiyat bulunamadıysa stokta yok mu?
      if (html.includes("Satıcı bulunamadı") || html.includes("Stokta yok")) {
        return { price: null, status: "Stokta Yok" };
      }
      return { price: null, status: "‼️" }; // Parse hatası
    }
  } catch (e) {
    console.error("Akakçe Fetch Hatası:", e);
    return { price: null, status: "‼️" };
  }
}

/**
 * Hangi ürünü çekeceğine karar verir ve görseli günceller.
 */
// Hangi ürünü çekeceğine karar verir ve görseli günceller.
export async function updateProductPrice(product, needsImageUpdate) {
  const isHB = product.platform === 'HB';
  let priceData;
  // --- AKAKÇE OPTİMİZASYONU KALDIRILDI ---
  // Akakçe işlemleri artık background.js üzerinde Phase 2 olarak,
  // Amazon/HB güncellemeleri tamamlandıktan sonra sırayla yapılacak.
  // Bu fonksiyon sadece ana platform (Amazon/HB) fiyatını çeker.

  try {
    // DEVAM: Ana Platform (Amazon/HB) Güncellemesi
    if (isHB) {
      // *** MEVCUT HB MANTIĞI ***
      try {
        const result = await createTabPromise(product);
        priceData = result;
      } catch (error) {
        console.error(`AFT (HB) Hata: ${error.message}`);
        priceData = { price: null, status: "‼️", picUrl: null };
      }
    } else {
      // *** MEVCUT AMAZON MANTIĞI ***
      priceData = await fetchAmazonProductPrice(product, needsImageUpdate);
    }

    const { price, status, picUrl, name } = priceData;
    const dbDataToSave = { id: product.id };

    // Değerleri güncelle
    if (product.akakceHistory) dbDataToSave.akakceHistory = product.akakceHistory;
    if (product.akakceUrl) dbDataToSave.akakceUrl = product.akakceUrl;

    if (price) {
      product.newPrice = price;
      dbDataToSave.newPrice = price;
    }

    product.status = status;
    dbDataToSave.status = status;

    if (name) {
      product.name = name;
      dbDataToSave.name = name;
    }

    if (picUrl) {
      dbDataToSave.picUrl = picUrl;
      product.picUrl = picUrl;
    }

    await saveToDB([dbDataToSave]);
    return product;

  } catch (error) {
    console.error(`updateProductPrice (ID: ${product.id}) genel hatası:`, error.message);
    product.status = "‼️";
    await saveToDB([{ id: product.id, status: "‼️" }]);
    return product;
  }
}