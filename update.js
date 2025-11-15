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

    console.log(`AFT (DEBUG) fetchAmazonProductPrice (ID: ${id}): Regex ile bulunan picUrl: ${picUrl}`);

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

/**
 * Hangi ürünü çekeceğine karar verir ve görseli günceller.
 */
export async function updateProductPrice(product, needsImageUpdate) {
  const isHB = product.platform === 'HB';
  let priceData;
  let finalResult;

  try {
    if (isHB) {
      // *** YENİ HB GÜNCELLEME MANTIĞI ***
      // Arka plana (background.js) mesaj GÖNDERMEK YERİNE,
      // doğrudan createTabPromise fonksiyonunu ÇAĞIR.
      try {
        // 2. BLOK DEĞİŞTİ:
        // createTabPromise (priceData) => { price, status, picUrl } dönecek
        const priceData = await createTabPromise(product);
        finalResult = { success: true, data: priceData };
      } catch (error) {
        console.error(`AFT (HB) createTabPromise hatası (ID: ${product.id}): ${error.message}`);
        finalResult = { success: false, error: error.message, data: { price: null, status: "‼️", picUrl: null } };
      }
      // 3. BLOK DEĞİŞTİ (if/else birleştirildi):
      if (!finalResult || !finalResult.success) {
        console.error(`AFT (HB) Kazıma Başarısız (ID: ${product.id}): ${finalResult?.error || 'Bilinmeyen hata'}`);
        priceData = { price: null, status: "‼️", picUrl: null };
      } else {
        priceData = finalResult.data;
      }
      // *** YENİ HB MANTIĞI SONU ***

    } else {

      // 2. Fiyatı, durumu ve görseli HTML'den çıkar
      priceData = await fetchAmazonProductPrice(product, needsImageUpdate);
    }

    const { price, status, picUrl, name } = priceData;
    const dbDataToSave = { id: product.id };
    product.newPrice = price; // price 'null' olabilir
    product.status = status;
    if (name) {
      product.name = name;
    }

    dbDataToSave.newPrice = price; // DB'ye de null/yeni fiyatı kaydet
    dbDataToSave.status = status;

    if (price) {
      product.newPrice = price;
      dbDataToSave.newPrice = price;
    }
    product.status = status;
    dbDataToSave.status = status;

    if (picUrl) {
      console.log(`AFT (DEBUG) updateProductPrice (ID: ${product.id}): Veritabanına kaydediliyor... picUrl: ${picUrl}`);
      dbDataToSave.picUrl = picUrl;
      product.picUrl = picUrl;
      // needsImageUpdate bayrağını (price.js'den gelir) loglama için kullanabiliriz:
      if (needsImageUpdate) {
        console.log(`AFT: Eksik görsel bulundu/güncellendi: ${product.id}`);
      }
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