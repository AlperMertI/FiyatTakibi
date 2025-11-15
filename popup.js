// popup.js

import { getAllFromSync, saveToSync, clearAllStorage, getAllFromDB, saveToDB, removeFromDB } from "./storage.js";
import { updateBadgeCount } from "./update.js";
import { renderProductList } from "./table.js";
import { showToast } from "./notifications.js";
import { checkPrices } from "./price.js";
import { parsePrice } from "./price-utils.js";

if (typeof browser === "undefined") {
  var browser = chrome;
}

let sortOrder = 1;
let groupIndex = 0;

export async function sortProducts(sortBy) {
  const products = await getAllFromSync();
  const productsList = [...products];

  switch (sortBy) {
    case "group":
      const groups = ["", "🔴", "🟡", "🟢"];
      groupIndex = (groupIndex + 1) % groups.length;
      productsList.sort((a, b) => {
        const aIndex = groups.indexOf(a.group || "");
        const bIndex = groups.indexOf(b.group || "");
        const groupA = (aIndex - groupIndex + groups.length) % groups.length;
        const groupB = (bIndex - groupIndex + groups.length) % groups.length;
        return groupA - groupB;
      });
      break;
    case "index":
      const order = await getAllFromDB();
      const orderMap = new Map(order.map((o) => [o.id, o.no]));
      productsList.sort((a, b) => {
        const aNo = orderMap.get(a.id) ?? Infinity;
        const bNo = orderMap.get(b.id) ?? Infinity;
        return sortOrder * (aNo - bNo);
      });
      break;
    case "name":
      productsList.sort((a, b) => {
        const nameA = a.name.toUpperCase();
        const nameB = b.name.toUpperCase();
        return sortOrder * nameA.localeCompare(nameB);
      });
      break;
    case "Oprice":
      productsList.sort((a, b) => {
        const priceA = parsePrice(a.oldPrice);
        const priceB = parsePrice(b.oldPrice);
        return sortOrder * (priceA - priceB);
      });
      break;
    case "Nprice":
      productsList.sort((a, b) => {
        const priceA = parsePrice(a.newPrice);
        const priceB = parsePrice(b.newPrice);
        return sortOrder * (priceA - priceB);
      });
    case "percent":
      productsList.sort((a, b) => {
        const priceA_old = parsePrice(a.oldPrice);
        const priceA_new = parsePrice(a.newPrice) || priceA_old; // newPrice yoksa oldPrice'ı baz al (%0 değişim)
        const percentA = (priceA_old > 0) ? (priceA_new - priceA_old) / priceA_old : 0;

        const priceB_old = parsePrice(b.oldPrice);
        const priceB_new = parsePrice(b.newPrice) || priceB_old;
        const percentB = (priceB_old > 0) ? (priceB_new - priceB_old) / priceB_old : 0;

        return sortOrder * (percentA - percentB);
      });
      break;
  }

  const newOrder = productsList.map((p, i) => ({ id: p.id, no: i + 1 }));
  await saveToDB(newOrder);
  renderProductList(productsList, document.getElementById("product-tbody"), updateBadgeCount); // DÜZELTME
  sortOrder *= -1;
}

export function sortByOrder(products, order) {
  const orderMap = new Map(order.map((o) => [o.id, o.no]));
  return products.slice().sort((a, b) => {
    const aNo = orderMap.get(a.id) || Infinity;
    const bNo = orderMap.get(b.id) || Infinity;
    return aNo - bNo;
  });
}

async function updateLastUpdateTimeElement() {
  const lastUpdateTimeElement = document.getElementById("last-update-time");
  if (!lastUpdateTimeElement) return;

  const lastUpdateData = await browser.storage.sync.get("lastUpdateTime");
  if (lastUpdateData.lastUpdateTime) {
    lastUpdateTimeElement.innerText = `Son Kontrol: ${lastUpdateData.lastUpdateTime}`;
  }
}

async function loadProductList() {
  const productListElement = document.getElementById("product-tbody");
  if (!productListElement) return;

  try {
    const products = await getAllFromSync(); // Sync'den gelen temel liste (pic yok)
    let order = await getAllFromDB();       // DB'den gelen tam liste (pic var)

    // Sync ve DB'yi senkronize et (Bu kısım önemli)
    if (order.length !== products.length) {
      const productMap = new Map(products.map(p => [p.id, p]));
      const orderMap = new Map(order.map(o => [o.id, o]));

      // DB'de olup sync'de olmayanları sil
      for (const o of order) {
        if (!productMap.has(o.id)) {
          await removeFromDB(o.id); // storage.js'den import etmeniz gerekebilir, ama sanırım table.js'de var.
        }
      }

      // Sync'de olup DB'de olmayanları ekle (merge)
      const newOrder = [];
      for (const p of products) {
        const existing = orderMap.has(p.id);
        if (!existing) {
          // Yeni ürünü DB'ye ekle (pic sonradan gelecek)
          newOrder.push({ id: p.id, no: order.length + newOrder.length + 1 });
        }
      }
      if (newOrder.length > 0) {
        await saveToDB(newOrder);
      }

      // Veriyi yeniden yükle
      order = await getAllFromDB();
    }

    // 'order' (DB'den gelen: pic, no, date, group) verisini hızlı erişim için bir Map'e dönüştür.
    const dbDataMap = new Map(order.map(item => [item.id, item]));

    // 'products' (Sync'den gelen: name, oldPrice, url) listesini temel alarak birleştir.
    const mergedData = products.map(product => {
      const dbProduct = dbDataMap.get(product.id);

      // Sync'deki (product) tüm veriyi al, DB'deki (dbProduct) tüm veriyle birleştir.
      return { ...product, ...(dbProduct || {}) };
    });

    // 'mergedData' dizisini 'no' (sıra numarası) ya göre sırala
    const sortedData = mergedData.sort((a, b) => (a.no || Infinity) - (b.no || Infinity));

    // 'renderProductList' fonksiyonuna birleştirilmiş ve sıralanmış (isim, fiyat, resim, no içeren) tam veriyi gönder
    renderProductList(sortedData, productListElement, updateBadgeCount);
    updateLastUpdateTimeElement();

  } catch (error) {
    console.error(error);
  }
}

/**
 * Tablodaki tek bir satırın "Güncel Fiyat" hücresine yükleme ikonu ekler.
 * @param {object} product - İşlenmeye başlayan ürün
 * @param {HTMLDivElement} productListBody - 'product-tbody' div elementi
 */
function startRowLoader(product, productListBody) {
  const row = productListBody.querySelector(`.product-row[data-id="${product.id}"]`);
  if (!row) return;

  const newPriceCell = row.querySelector(".cell-price-new");
  if (newPriceCell) {
    newPriceCell.innerHTML = '<span class="material-icons">cached</span>';
    newPriceCell.classList.add('price-loader');
  }
}

/**
 * Tablodaki tek bir satırın "Güncel Fiyat" hücresini günceller.
 * @param {object} product - Güncellenmiş ürün nesnesi (price.js'den gelir)
 * @param {HTMLDivElement} productListBody - 'product-tbody' div elementi
 */
function updateRowUI(product, productListBody) {
  // 1. data-id attribute'u üzerinden satırı bul (artık .product-row)
  const row = productListBody.querySelector(`.product-row[data-id="${product.id}"]`);
  if (!row) return;

  // 2. "Güncel Fiyat" hücresini bul (5. hücre, .cell-price-new)
  const newPriceCell = row.querySelector(".cell-price-new");
  if (!newPriceCell) return;

  // 2.5. "Görsel" hücresini ve içindeki 'img' elementini bul
  const imageCell = row.querySelector(".cell-image");
  const previewImg = imageCell ? imageCell.querySelector(".preview-img") : null;

  // 2.6. Eğer ürün verisinde görsel varsa ve 'img' elementi bulunduysa, görseli güncelle
  // (updateProductPrice'dan dönen 'product' nesnesinde artık picUrl olmalı)
  if (previewImg) {
    // 2.6. Eğer ürün verisinde görsel varsa (updateProductPrice'dan dönen)
    if (product.picUrl) {
      console.log(`AFT (DEBUG) updateRowUI (ID: ${product.id}): 'img' elementi bulundu. src şuna ayarlanıyor: ${product.picUrl}`);
      previewImg.src = product.picUrl;
      previewImg.classList.remove("no-image");
    } else {
      console.log(`AFT (DEBUG) updateRowUI (ID: ${product.id}): 'img' elementi bulundu ancak product.picUrl BOŞ.`);
    }
  } else {
    console.log(`AFT (DEBUG) updateRowUI (ID: ${product.id}): 'previewImg' elementi bulunamadı.`);
  }

  // 3. Fiyat ve Durum verilerini al
  const { oldPrice, newPrice, status } = product;

  // 4. Hücre içeriğini temizle ve animasyon sınıfını kaldır (varsa)
  newPriceCell.innerHTML = "";
  newPriceCell.classList.remove('price-loader');

  // 5. Duruma göre hücreyi doldur
  if (status === "‼️") {
    newPriceCell.textContent = "Hata ‼️";
    newPriceCell.style.color = "#E74C3C"; // Kırmızı
    newPriceCell.title = "Ürün sayfası bulunamadı veya yapı değişti";
  } else if (status === "Stokta Yok") {
    newPriceCell.textContent = "Stok Yok";
    newPriceCell.style.color = "#E67E22"; // Turuncu
  } else if (newPrice) {
    // Fiyatları karşılaştırmak için parse et
    const oldP = parsePrice(oldPrice);
    const newP = parsePrice(newPrice);

    // Renklendirme
    newPriceCell.style.color = !oldP ? "#3498DB" : newP < oldP ? "#2ECC71" : newP > oldP ? "#E74C3C" : "";
    newPriceCell.textContent = newPrice.replace("TL", " TL");

    // 6. Sadece fiyat değiştiyse "price-flash" animasyonunu uygula
    if (status === "⬇️" || status === "⬆️" || status === "➕") {
      // Animasyonun tekrar tetiklenmesi için küçük bir hile (reflow)
      newPriceCell.classList.remove('price-flash');
      void newPriceCell.offsetWidth; // DOM'u yeniden hesaplamaya zorla
      newPriceCell.classList.add('price-flash');
    }
  } else {
    // Fiyat bilgisi yoksa (henüz çekilmemişse)
    newPriceCell.textContent = "";
  }
  // DURUM GÜNCELLEME ---
  // 7. "Durum" hücresini bul
  const statusCell = row.querySelector(".cell-status");
  if (statusCell) {
    // 8. Durum metnini güncelle (table.js'deki mantıkla aynı)
    if (status === "Stokta Yok") {
      statusCell.textContent = "Stok Yok";
    } else {
      statusCell.textContent = status || "";
    }

    // 9. Durum başlığını (title) güncelle
    const statusTitles = {
      "➕": "Ürün stoğa girdi (Onaylamak için tıkla)",
      "⬆️": "Zam geldi (Onaylamak için tıkla)",
      "⬇️": "İndirim geldi (Onaylamak için tıkla)",
      "‼️": "Kontrol hatası (Sayfa bulunamadı veya yapı değişti)",
      "Stokta Yok": "Ürün stokta bulunmuyor",
      "🟰": "Fiyat değişmedi",
      "✅": "Fiyat başarıyla kontrol edildi"
    };
    statusCell.title = statusTitles[status] || "";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const feedbackButton = document.getElementById("feedback-button");
  const deleteAllButton = document.getElementById("delete-all");
  const settingsButton = document.getElementById("settings-button");
  const productList = document.getElementById("product-tbody");
  const searchBox = document.getElementById("search-box");
  const productGroupHeader = document.getElementById("p-group");
  const productIndexHeader = document.getElementById("p-number");
  const productNameHeader = document.getElementById("p-name");
  const productOldPriceHeader = document.getElementById("p-Oprice");
  const productNewPriceHeader = document.getElementById("p-Nprice");
  const updateStatusButton = document.getElementById("updateStatus-button");
  const updateButton = document.getElementById("update-button");
  const addProductButton = document.getElementById("add-product-button");
  const productPercentHeader = document.getElementById("p-percent");

  if (!deleteAllButton || !productList) {
    return;
  }

  setupEventListeners(productList);
  loadProductList();

  async function filterProductsByName(query) {
    const products = await getAllFromSync();
    const order = await getAllFromDB();
    const filteredProducts = products.filter(
      (product) => product.name.toLowerCase().includes(query.toLowerCase()) || product.id.toLowerCase().includes(query.toLowerCase())
    );
    const orderMap = new Map(order.map((o) => [o.id, o.no]));
    filteredProducts.sort((a, b) => {
      const aNo = orderMap.get(a.id) ?? Infinity;
      const bNo = orderMap.get(b.id) ?? Infinity;
      return aNo - bNo;
    });
    renderProductList(filteredProducts, productList, updateBadgeCount);
  }

  function setupEventListeners(productListBody) {
    feedbackButton.addEventListener("click", () => {
      window.open("https://docs.google.com/forms/d/e/1FAIpQLScg5dpL7Hx4WXFhPzFxmblH3obSecW9QA-KCQZrusiKXQJ8uQ/viewform?usp=dialog", "_blank");
    });

    deleteAllButton.addEventListener("click", async () => {
      if (confirm("Tüm ürünleri silmek istediğinize emin misiniz?")) {
        await clearAllStorage();
        renderProductList([], productListBody, updateBadgeCount);
        showToast("Tüm ürünler silindi.", "success");
        updateBadgeCount([]);
      }
    });

    settingsButton.addEventListener("click", () => {
      browser.runtime.openOptionsPage();
    });
    productGroupHeader.addEventListener("click", () => sortProducts("group"));
    productIndexHeader.addEventListener("click", () => sortProducts("index"));
    productNameHeader.addEventListener("click", () => sortProducts("name"));
    productOldPriceHeader.addEventListener("click", () => sortProducts("Oprice"));
    productPercentHeader.addEventListener("click", () => sortProducts("percent"));
    productNewPriceHeader.addEventListener("click", () => sortProducts("Nprice"));

    if (updateButton) {
      updateButton.addEventListener("click", () => {
        // --- YUKLEME BASLAT ---
        updateButton.classList.add('loading');
        updateButton.disabled = true;
        showToast("Fiyatlar kontrol ediliyor...", "info");

        // --- ASIL ISLEM ---
        // 2. Fiyatlari kontrol et ve işlem başladığında/bittiğinde callback'leri çağır
        checkPrices({
          onProductProcessStart: (product) => startRowLoader(product, productListBody),
          onProductProcessed: (product) => updateRowUI(product, productListBody)
        })
          .then(async () => {
            // --- YUKLEME BITTI (TÜMÜ BİTTİ) ---
            updateButton.classList.remove('loading');
            updateButton.disabled = false;
            showToast("Tüm fiyatlar güncellendi.", "success");

            // Son kontrol zamanını (badge gibi) güncelle
            await updateLastUpdateTimeElement();

          }).catch((error) => {
            // --- HATA DURUMU ---
            console.error("Fiyat kontrolü başarısız oldu:", error);
            showToast("Hata: Fiyat kontrolü başarısız oldu.", "error");

            // Hata olsa bile listeyi eski haline getirip kilitleri kaldir
            loadProductList();
            updateButton.classList.remove('loading');
            updateButton.disabled = false;
          });
      });
    }

    if (searchBox) {
      searchBox.addEventListener("input", () => filterProductsByName(searchBox.value));
    }

    // URL'DEN ÜRÜN EKLEME
    if (addProductButton) {
      addProductButton.addEventListener("click", () => {
        const url = prompt("Lütfen Amazon veya Hepsiburada ürün linkini yapıştırın:");
        if (!url) return; // Kullanıcı iptal etti

        let platform = null;
        let id = null;

        // URL Analizi (Basit)
        if (url.includes("amazon.com.tr")) {
          const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
          if (match && match[1]) {
            id = match[1];
            platform = "AMZ";
          }
        } else if (url.includes("hepsiburada.com")) {
          // Hepsiburada linkleri -p-'den sonraki kodu alır (örn: HBCV00006Y9YTO)
          const match = url.match(/-p-([a-zA-Z0-9]+)/);
          if (match && match[1]) {
            id = match[1];
            platform = "HB";
          }
        }

        if (!id || !platform) {
          showToast("Geçersiz URL. Lütfen geçerli bir Amazon veya HB linki girin.", "error");
          return;
        }

        // Arka plana mesaj gönder
        showToast("Ürün ekleniyor, lütfen bekleyin...", "info");
        browser.runtime.sendMessage({ action: "addNewProductFromUrl", url, id, platform }, (response) => {
          if (browser.runtime.lastError) {
            showToast(`Hata: ${browser.runtime.lastError.message}`, "error");
            return;
          }

          if (response && response.success) {
            showToast(response.message, "success");
            loadProductList(); // Liste yenilensin
          } else {
            showToast(response.message || "Bilinmeyen bir hata oluştu.", "error");
          }
        });
      });
    }

    updateStatusButton.addEventListener("click", async () => {
      try {
        let products = await getAllFromSync();
        products.forEach((product) => {
          if (product.status === "➕" || product.status === "⬇️" || product.status === "⬆️") {
            product.oldPrice = product.newPrice;
            product.newPrice = null;
            product.status = null;
          }
        });
        await saveToSync(products);
        let order = await getAllFromDB();
        if (order.length === 0 || order.length !== products.length) {
          order = products.map((product, index) => ({ id: product.id, no: index + 1 }));
          await saveToDB(order);
        }

        await loadProductList();

        showToast("Ürün fiyatları güncellendi.", "success");
      } catch (error) {
        console.error("Güncelleme işlemi sırasında hata oluştu:", error);
      }
    });
  }
});