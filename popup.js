// popup.js
import { getAllFromSync, saveToSync, clearAllStorage, getAllFromDB, saveToDB, removeFromDB } from "./storage.js";
import { updateBadgeCount } from "./update.js";
import { renderProductList } from "./table.js";
import { showToast } from "./notifications.js";
import { checkPrices } from "./price.js";
import { parsePrice, timeAgo } from "./price-utils.js";
import { fetchProductData } from "./chart.js";

if (typeof browser === "undefined") {
  var browser = chrome;
}

// --- Değişkenler ---
let activeSortState = { type: 'index', direction: 0 };
let dateSortState = 0;
let lastChangeSortState = 0;
let groupIndex = 0;
let sortOrder = 1;
let nPriceSortMode = 'price'; // Varsayılan: Fiyata göre sırala

// Tarih string'ini parse etme
function parseDateStr(dateStr) {
  if (!dateStr) return 0;
  const parts = dateStr.split(".");
  if (parts.length === 3) {
    return new Date(`${parts[1]}/${parts[0]}/${parts[2]}`).getTime();
  }
  return 0;
}

function saveSortState() {
  browser.storage.local.set({
    sortState: {
      type: activeSortState.type,
      direction: activeSortState.direction,
      dateSortState,
      lastChangeSortState,
      sortOrder,
      groupIndex,
      nPriceSortMode
    }
  });
}

// Geçmiş Tarihleri Tamamlama
async function backfillHistoryDates() {
  const products = await getAllFromSync();
  const missing = products.filter(p => p.id && p.newPrice);
  const batch = missing.slice(0, 5);

  if (batch.length === 0) return;

  let changed = false;

  for (const p of batch) {
    // Zaten yakın zamanda güncellendiyse atla
    if (p.lastChangeDate && (new Date().getTime() - new Date(p.lastChangeDate).getTime() > 3600000)) {
      continue;
    }
    try {
      const data = await fetchProductData(p.id);
      if (data && data.length > 0) {
        data.sort((a, b) => new Date(a.tarih) - new Date(b.tarih));
        const currentPriceVal = parsePrice(p.newPrice);
        let foundDate = null;
        for (let i = data.length - 1; i >= 0; i--) {
          const histPrice = parsePrice(data[i].fiyat);
          if (Math.abs(histPrice - currentPriceVal) < 0.1) {
            foundDate = data[i].tarih;
          } else {
            break;
          }
        }
        if (foundDate && p.lastChangeDate !== foundDate) {
          p.lastChangeDate = foundDate;
          changed = true;
          const row = document.querySelector(`.product-row[data-id="${p.id}"]`);
          if (row) {
            const subText = row.querySelector(".cell-price-new .sub-text");
            if (subText) {
              const ago = timeAgo(foundDate);
              subText.textContent = `🕒 ${ago}`;
              subText.title = new Date(foundDate).toLocaleString("tr-TR");
            }
          }
        }
      }
    } catch (e) { }
  }
  if (changed) await saveToSync(products);
}

async function applySortAndRender() {
  const productsSync = await getAllFromSync();
  const productsDB = await getAllFromDB();
  const dbMap = new Map(productsDB.map(item => [item.id, item]));

  let productsList = productsSync.map(p => ({
    ...p,
    ...(dbMap.get(p.id) || {})
  }));

  const type = activeSortState.type;
  const dir = activeSortState.direction;

  // Buton ikonlarını güncelle
  const btnDate = document.querySelector("#p-number button");
  const btnStatus = document.querySelector("#updateStatus-button button");
  const btnNPriceMain = document.getElementById("btn-nprice-main");

  if (btnDate) btnDate.textContent = type === 'dateAdded' ? (dir === 1 ? "📅⬇️" : dir === 2 ? "📅⬆️" : "#️⃣") : "#️⃣";
  if (btnStatus) btnStatus.textContent = type === 'lastChange' ? (dir === 1 ? "🕒⬇️" : dir === 2 ? "🕒⬆️" : "✅") : "✅";

  if (btnNPriceMain) {
    let icon = "";
    if (type === 'Nprice') icon = dir === 1 ? " ⬇️" : " ⬆️";
    const modeLabel = nPriceSortMode === 'price' ? "Fiyat" : "Tarih";
    btnNPriceMain.textContent = `Güncel (${modeLabel})${icon}`;
  }

  // --- GÜVENLİ SIRALAMA FONKSİYONU ---
  // Değeri olmayanları (null, NaN, 0) her zaman listenin sonuna atar
  const safeSort = (a, b, valA, valB, direction) => {
    const validA = valA !== null && valA !== undefined && !isNaN(valA) && valA !== 0 && isFinite(valA);
    const validB = valB !== null && valB !== undefined && !isNaN(valB) && valB !== 0 && isFinite(valB);

    if (!validA && !validB) return 0;
    if (!validA) return 1; // A geçersizse sona
    if (!validB) return -1; // B geçersizse sona

    return direction * (valA - valB);
  };

  // Sıralama Mantığı
  if (type === "dateAdded") {
    if (dir === 0) productsList.sort((a, b) => (a.no || Infinity) - (b.no || Infinity));
    else productsList.sort((a, b) => {
      const dA = parseDateStr(a.date), dB = parseDateStr(b.date);
      // Tarih yoksa sona at
      return safeSort(a, b, dA, dB, dir === 1 ? -1 : 1);
    });
  } else if (type === "lastChange") {
    if (dir === 0) productsList.sort((a, b) => (a.no || Infinity) - (b.no || Infinity));
    else productsList.sort((a, b) => {
      const tA = a.lastChangeDate ? new Date(a.lastChangeDate).getTime() : 0;
      const tB = b.lastChangeDate ? new Date(b.lastChangeDate).getTime() : 0;
      return safeSort(a, b, tA, tB, dir === 1 ? -1 : 1);
    });
  } else if (type === "Nprice") {
    // GÜNCEL FİYAT KOLONU
    if (nPriceSortMode === 'lastChange') {
      // Tarihe Göre
      productsList.sort((a, b) => {
        const tA = a.lastChangeDate ? new Date(a.lastChangeDate).getTime() : 0;
        const tB = b.lastChangeDate ? new Date(b.lastChangeDate).getTime() : 0;
        return safeSort(a, b, tA, tB, dir * -1);
      });
    } else {
      // Fiyata Göre
      productsList.sort((a, b) => {
        // SADECE YENİ FİYATA BAK (Eski fiyata düşme)
        // Böylece "Stokta Yok" (null) olanlar her zaman en alta gider.
        const pA = parsePrice(a.newPrice);
        const pB = parsePrice(b.newPrice);
        return safeSort(a, b, pA, pB, dir);
      });
    }
  } else if (type === "index") {
    productsList.sort((a, b) => (a.no || Infinity) - (b.no || Infinity));
  } else {
    switch (type) {
      case "group":
        const groups = ["", "🔴", "🟡", "🟢"];
        productsList.sort((a, b) => {
          const aIdx = groups.indexOf(a.group || ""), bIdx = groups.indexOf(b.group || "");
          return aIdx - bIdx;
        });
        break;
      case "name":
        productsList.sort((a, b) => dir * a.name.toUpperCase().localeCompare(b.name.toUpperCase()));
        break;
      case "Oprice":
        productsList.sort((a, b) => {
          const pA = parsePrice(a.oldPrice);
          const pB = parsePrice(b.oldPrice);
          return safeSort(a, b, pA, pB, dir);
        });
        break;
      case "prevPrice":
        productsList.sort((a, b) => {
          const pA = parsePrice(a.previousPrice);
          const pB = parsePrice(b.previousPrice);
          return safeSort(a, b, pA, pB, dir);
        });
        break;
      case "percent":
        productsList.sort((a, b) => {
          const pA = parsePrice(a.oldPrice), pAn = parsePrice(a.newPrice) || pA;
          const perA = pA > 0 ? (pAn - pA) / pA : 0;
          const pB = parsePrice(b.oldPrice), pBn = parsePrice(b.newPrice) || pB;
          const perB = pB > 0 ? (pBn - pB) / pB : 0;
          return safeSort(a, b, perA, perB, dir);
        });
        break;
    }
  }

  renderProductList(productsList, document.getElementById("product-tbody"), updateBadgeCount);
}

export async function sortProducts(sortBy) {
  if (sortBy === "dateAdded") {
    dateSortState = (dateSortState + 1) % 3;
    lastChangeSortState = 0;
    activeSortState = { type: 'dateAdded', direction: dateSortState };
  } else if (sortBy === "lastChange") {
    lastChangeSortState = (lastChangeSortState + 1) % 3;
    dateSortState = 0;
    activeSortState = { type: 'lastChange', direction: lastChangeSortState };
  } else {
    activeSortState = { type: sortBy, direction: sortOrder * -1 };
    sortOrder *= -1;
    if (sortBy === "group") groupIndex = (groupIndex + 1) % 4;
  }
  saveSortState();
  await applySortAndRender();
}

async function updateLastUpdateTimeElement() {
  const el = document.getElementById("last-update-time");
  if (!el) return;
  const data = await browser.storage.sync.get("lastUpdateTime");
  if (data.lastUpdateTime) el.innerText = `Son Kontrol: ${data.lastUpdateTime}`;
}

async function loadProductList() {
  const productListElement = document.getElementById("product-tbody");
  if (!productListElement) return;

  const stored = await browser.storage.local.get('sortState');
  if (stored && stored.sortState) {
    const s = stored.sortState;
    activeSortState = { type: s.type, direction: s.direction };
    dateSortState = s.dateSortState || 0;
    lastChangeSortState = s.lastChangeSortState || 0;
    sortOrder = s.sortOrder || 1;
    groupIndex = s.groupIndex || 0;
    nPriceSortMode = s.nPriceSortMode || 'price';
  }

  try {
    const products = await getAllFromSync();
    let order = await getAllFromDB();
    if (order.length !== products.length) {
      const productMap = new Map(products.map(p => [p.id, p]));
      const orderMap = new Map(order.map(o => [o.id, o]));
      for (const o of order) { if (!productMap.has(o.id)) await removeFromDB(o.id); }
      const newOrder = [];
      for (const p of products) {
        if (!orderMap.has(p.id)) newOrder.push({ id: p.id, no: order.length + newOrder.length + 1 });
      }
      if (newOrder.length > 0) await saveToDB(newOrder);
    }
  } catch (e) { console.error(e); }

  await applySortAndRender();
  updateLastUpdateTimeElement();
  backfillHistoryDates();
}

function startRowLoader(product, productListBody) {
  const row = productListBody.querySelector(`.product-row[data-id="${product.id}"]`);
  if (!row) return;
  const newPriceCell = row.querySelector(".cell-price-new span:first-child");
  if (newPriceCell) newPriceCell.textContent = "⏳";
}

function updateRowUI(product, productListBody) {
  const row = productListBody.querySelector(`.product-row[data-id="${product.id}"]`);
  if (!row) return;

  const newPriceCell = row.querySelector(".cell-price-new");
  if (!newPriceCell) return;

  const imageCell = row.querySelector(".cell-image");
  const previewImg = imageCell ? imageCell.querySelector(".preview-img") : null;
  if (previewImg && product.picUrl) {
    previewImg.src = product.picUrl;
    previewImg.classList.remove("no-image");
  }

  let priceTextSpan = newPriceCell.querySelector("span:not(.sub-text)");
  if (!priceTextSpan) {
    priceTextSpan = document.createElement("span");
    newPriceCell.prepend(priceTextSpan);
  }

  const { oldPrice, newPrice, status, lastChangeDate } = product;

  if (status === "‼️") {
    priceTextSpan.textContent = "Hata ‼️";
    priceTextSpan.style.color = "#E74C3C";
  } else if (status === "Stokta Yok") {
    priceTextSpan.textContent = "Stok Yok";
    priceTextSpan.style.color = "#E67E22";
  } else if (newPrice) {
    const oldP = parsePrice(oldPrice);
    const newP = parsePrice(newPrice);
    priceTextSpan.style.color = !oldP ? "#3498DB" : newP < oldP ? "#2ECC71" : newP > oldP ? "#E74C3C" : "";
    priceTextSpan.textContent = newPrice.replace("TL", " TL");

    if (["⬇️", "⬆️", "➕"].includes(status)) {
      newPriceCell.classList.remove('price-flash');
      void newPriceCell.offsetWidth;
      newPriceCell.classList.add('price-flash');
    }
  } else {
    priceTextSpan.textContent = "";
  }

  let subTextSpan = newPriceCell.querySelector(".sub-text");
  if (!subTextSpan) {
    subTextSpan = document.createElement("span");
    subTextSpan.className = "sub-text";
    newPriceCell.appendChild(subTextSpan);
  }

  const ago = timeAgo(lastChangeDate);
  subTextSpan.textContent = ago ? `🕒 ${ago}` : "Değişim: -";
  if (lastChangeDate) subTextSpan.title = new Date(lastChangeDate).toLocaleString("tr-TR");

  const statusCell = row.querySelector(".cell-status");
  if (statusCell && statusCell.childNodes[0].nodeType === Node.TEXT_NODE) {
    statusCell.childNodes[0].textContent = status === "Stokta Yok" ? "Stok Yok" : (status || "");
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
  const productPrevPriceHeader = document.getElementById("p-prevPrice");
  const productPercentHeader = document.getElementById("p-percent");

  const updateStatusButton = document.getElementById("updateStatus-button");
  const updateButton = document.getElementById("update-button");
  const addProductButton = document.getElementById("add-product-button");

  const btnNPriceMain = document.getElementById("btn-nprice-main");
  const btnNPriceTrigger = document.getElementById("btn-nprice-menu-trigger");
  const menuNPrice = document.getElementById("nprice-menu");
  const optSortPrice = document.getElementById("opt-sort-price");
  const optSortDate = document.getElementById("opt-sort-date");

  if (!deleteAllButton || !productList) return;

  setupEventListeners(productList);
  loadProductList();

  async function filterProductsByName(query) {
    const products = await getAllFromSync();
    const order = await getAllFromDB();
    const dbMap = new Map(order.map(item => [item.id, item]));

    let filtered = products.filter(
      (p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.id.toLowerCase().includes(query.toLowerCase())
    ).map(p => ({ ...p, ...(dbMap.get(p.id) || {}) }));

    filtered.sort((a, b) => (a.no || Infinity) - (b.no || Infinity));
    renderProductList(filtered, productList, updateBadgeCount);
  }

  function setupEventListeners(productListBody) {
    feedbackButton.addEventListener("click", () => {
      window.open("https://docs.google.com/forms/d/e/1FAIpQLScg5dpL7Hx4WXFhPzFxmblH3obSecW9QA-KCQZrusiKXQJ8uQ/viewform?usp=dialog", "_blank");
    });

    deleteAllButton.addEventListener("click", async () => {
      if (confirm("Tüm ürünleri silmek istediğinize emin misiniz?")) {
        await clearAllStorage();
        browser.storage.local.remove('sortState');
        activeSortState = { type: 'index', direction: 0 };
        renderProductList([], productListBody, updateBadgeCount);
        showToast("Tüm ürünler silindi.", "success");
        updateBadgeCount([]);
      }
    });

    settingsButton.addEventListener("click", () => browser.runtime.openOptionsPage());

    productGroupHeader.addEventListener("click", () => sortProducts("group"));
    productIndexHeader.addEventListener("click", () => sortProducts("dateAdded"));
    productNameHeader.addEventListener("click", () => sortProducts("name"));
    productOldPriceHeader.addEventListener("click", () => sortProducts("Oprice"));
    productPrevPriceHeader.addEventListener("click", () => sortProducts("prevPrice"));
    productPercentHeader.addEventListener("click", () => sortProducts("percent"));

    // --- GÜNCEL FİYAT DROPDOWN OLAYLARI ---
    if (btnNPriceMain) btnNPriceMain.addEventListener("click", () => sortProducts("Nprice"));

    if (btnNPriceTrigger) {
      btnNPriceTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelectorAll(".group-menu").forEach(m => { if (m !== menuNPrice) m.style.display = 'none'; });
        menuNPrice.style.display = menuNPrice.style.display === "block" ? "none" : "block";
      });
    }

    if (optSortPrice) {
      optSortPrice.addEventListener("click", () => {
        nPriceSortMode = 'price';
        menuNPrice.style.display = "none";
        sortProducts("Nprice");
      });
    }

    if (optSortDate) {
      optSortDate.addEventListener("click", () => {
        nPriceSortMode = 'lastChange';
        menuNPrice.style.display = "none";
        sortProducts("Nprice");
      });
    }

    // --- DURUM KOLONU (Sadece Onaylama) ---
    const statusActionBtn = updateStatusButton.querySelector('button');
    if (statusActionBtn) {
      statusActionBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          let products = await getAllFromSync();
          let hasChanges = false;
          products.forEach((product) => {
            if (["➕", "⬇️", "⬆️"].includes(product.status)) {
              product.oldPrice = product.newPrice;
              product.status = null;
              hasChanges = true;
            }
          });
          if (hasChanges) {
            await saveToSync(products);
            let order = await getAllFromDB();
            if (order.length === 0) order = products.map((p, i) => ({ id: p.id, no: i + 1 }));
            const updatesForDB = products.map(p => ({ id: p.id, oldPrice: p.oldPrice, newPrice: p.newPrice, status: null }));
            await saveToDB(updatesForDB);
            await loadProductList();
            showToast("Tüm değişiklikler onaylandı.", "success");
          } else {
            showToast("Onaylanacak yeni bir değişim yok.", "info");
          }
        } catch (error) {
          console.error("Toplu güncelleme hatası:", error);
          showToast("İşlem sırasında hata oluştu.", "error");
        }
      });
    }
    // Başlık tıklamasına da sıralama ekleyelim (opsiyonel, istenmişti)
    updateStatusButton.addEventListener("click", (e) => {
      if (e.target.tagName !== 'BUTTON') sortProducts("lastChange");
    });

    if (updateButton) {
      updateButton.addEventListener("click", () => {
        updateButton.classList.add('loading');
        updateButton.disabled = true;
        showToast("Fiyatlar kontrol ediliyor...", "info");

        checkPrices({
          onProductProcessStart: (product) => startRowLoader(product, productListBody),
          onProductProcessed: (product) => updateRowUI(product, productListBody)
        })
          .then(async () => {
            updateButton.classList.remove('loading');
            updateButton.disabled = false;
            showToast("Tüm fiyatlar güncellendi.", "success");
            await updateLastUpdateTimeElement();
            applySortAndRender();
          }).catch((error) => {
            console.error("Fiyat kontrolü başarısız oldu:", error);
            showToast("Hata: Fiyat kontrolü başarısız oldu.", "error");
            loadProductList();
            updateButton.classList.remove('loading');
            updateButton.disabled = false;
          });
      });
    }

    if (searchBox) {
      searchBox.addEventListener("input", () => filterProductsByName(searchBox.value));
    }

    if (addProductButton) {
      addProductButton.addEventListener("click", () => {
        const url = prompt("Lütfen Amazon veya Hepsiburada ürün linkini yapıştırın:");
        if (!url) return;
        let platform = null; let id = null;
        if (url.includes("amazon.com.tr")) {
          const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
          if (match) { id = match[1]; platform = "AMZ"; }
        } else if (url.includes("hepsiburada.com")) {
          const match = url.match(/-p-([a-zA-Z0-9]+)/);
          if (match) { id = match[1]; platform = "HB"; }
        }
        if (!id || !platform) {
          showToast("Geçersiz URL.", "error");
          return;
        }
        showToast("Ürün ekleniyor...", "info");
        browser.runtime.sendMessage({ action: "addNewProductFromUrl", url, id, platform }, (response) => {
          if (response && response.success) {
            showToast(response.message, "success");
            loadProductList();
          } else {
            showToast(response ? response.message : "Hata", "error");
          }
        });
      });
    }
  }
});