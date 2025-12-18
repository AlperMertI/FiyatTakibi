// popup.js
import { getAllFromSync, saveToSync, clearAllStorage, getAllFromDB, saveToDB, removeFromDB, getProductFromDB } from "./storage.js";
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
let currentUpdateState = null;
let preUpdateSortState = null;
let productsList = []; // Global list for helpers to access
let isListLoaded = false;
let lastUpdateStateJson = null;
let lastSortedIds = "";

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

// Throttling for sort
let lastSortTime = 0;

export async function applySortAndRender(options = {}) {
  const now = Date.now();
  const { forceFetch = false } = options;

  // Güncelleme sırasında çok sık render'ı engelle
  if (currentUpdateState && currentUpdateState.isUpdating && !forceFetch && (now - lastSortTime < 1000)) {
    return;
  }

  // Normal durumda hız sınırı
  if (!forceFetch && now - lastSortTime < 300) return;
  lastSortTime = now;

  try {
    // Liste boşsa veya zorunluysa veriyi tazele
    if (forceFetch || productsList.length === 0 || !currentUpdateState?.isUpdating) {
      const productsSync = await getAllFromSync();
      const productsDB = await getAllFromDB();
      if (!productsSync) throw new Error("Sync data is null");
      const dbMap = new Map(productsDB.map(item => [item.id, item]));
      productsList = productsSync.map(p => ({
        ...p,
        ...(dbMap.get(p.id) || {})
      }));
    }

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

    // --- DİNAMİK SIRALAMA (GÜNCELLEME SIRASINDA) ---
    if (currentUpdateState && currentUpdateState.isUpdating) {
      // console.log("AFT: Sorting - State Updated");
      productsList.sort((a, b) => {
        // Puan Sistemi:
        // İşleniyor: 1000 (En üst)
        // Sırada: 100
        // Bekleyen Aşama: 10

        // Tamamlandı (Şu anki fazda): -100
        const getScore = (id) => {
          let score = 10;
          if (currentUpdateState.processingIds.includes(id)) score = 1000;
          else if (currentUpdateState.queueIds.includes(id)) score = 100;
          else if (currentUpdateState.processedIds.includes(id)) score = -100;
          return score;
        };

        const scoreA = getScore(a.id);
        const scoreB = getScore(b.id);

        // Detailed logging for a few items if needed, or summary
        // console.log(`ID: ${a.id} Score: ${scoreA} vs ID: ${b.id} Score: ${scoreB}`);

        if (scoreA !== scoreB) return scoreB - scoreA;

        // Aynı gruptaysalar ID veya no'ya göre sabit kalsınlar (Kuyruk sırasını koru)
        return (a.no || Infinity) - (b.no || Infinity);
      });

      // console.log("AFT: Sorted Top 5:", productsList.slice(0, 5).map(p => ({ id: p.id, name: p.name })));
    } else {
      // Sıralama Mantığı
      if (type === "dateAdded") {
        if (dir === 0) productsList.sort((a, b) => (a.no || Infinity) - (b.no || Infinity));
        else productsList.sort((a, b) => {
          const dA = parseDateStr(a.date), dB = parseDateStr(b.date);
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
        if (nPriceSortMode === 'lastChange') {
          productsList.sort((a, b) => {
            const tA = a.lastChangeDate ? new Date(a.lastChangeDate).getTime() : 0;
            const tB = b.lastChangeDate ? new Date(b.lastChangeDate).getTime() : 0;
            return safeSort(a, b, tA, tB, dir * -1);
          });
        } else {
          productsList.sort((a, b) => {
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
              return dir * (aIdx - bIdx);
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
    }

    // Sıralama bittikten sonra ORDER değişmiş mi kontrol et
    const currentOrder = productsList.map(p => p.id).join(",");
    if (currentOrder === lastSortedIds && !forceFetch) {
      // Sıralama değişmedi, re-render'a gerek yok. 
      // Sadece Row bazlı güncellemeler (updateUIWithState) yeterli.
      return;
    }
    lastSortedIds = currentOrder;

    // RENDER: Sıralama veya veriler değiştiyse ekrana bas
    renderProductList(productsList, document.getElementById("product-tbody"), updateBadgeCount, currentUpdateState);
    if (typeof updateConfirmButtonState === 'function') {
      updateConfirmButtonState(productsList);
    }

  } catch (error) {
    console.error("AFT: Sorting error (throttled)", error);
  }
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
  isListLoaded = true;
  updateLastUpdateTimeElement();
  backfillHistoryDates();
}

function startRowLoader(product, productListBody) {
  const row = productListBody.querySelector(`.product-row[data-id="${product.id}"]`);
  if (!row) return;
  const newPriceCell = row.querySelector(".cell-price-new span:first-child");
  if (newPriceCell) newPriceCell.textContent = "⏳";
}

function updateRowUI(product, productListBody, options = {}) {
  const row = productListBody.querySelector(`.product-row[data-id="${product.id}"]`);
  if (!row) return;

  const { akakceLoading = false, queued = false } = options;

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
    priceTextSpan.style.color = "#f43f5e";
  } else if (status === "Stokta Yok") {
    priceTextSpan.textContent = "Stok Yok";
    priceTextSpan.style.color = "#fbbf24";
  } else if (newPrice) {
    const oldP = parsePrice(oldPrice);
    const newP = parsePrice(newPrice);
    priceTextSpan.style.color = !oldP ? "#3b82f6" : newP < oldP ? "#10b981" : newP > oldP ? "#f43f5e" : "";
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

  // LOGGING (Disabled for performance)
  // if (product.akakceHistory) console.log(`[DEBUG] updateRowUI for ${product.name}: akakceHistory found`);

  const akakceInfo = row.querySelector(".akakce-info-container");
  if (akakceInfo) {
    let content = "";
    if (product.akakceHistory && product.akakceHistory.length > 0) {
      const latest = product.akakceHistory.reduce((prev, curr) => (new Date(prev.tarih) > new Date(curr.tarih)) ? prev : curr);
      const diffDays = Math.floor((new Date() - new Date(latest.tarih)) / (1000 * 60 * 60 * 24));
      const oldWarning = diffDays > 3 ? ` (${diffDays}g önce)` : '';
      content = `<div style="font-size:11px; color:#3498DB; margin-top:2px;"><span style="font-weight:600">Akakçe:</span> ${latest.fiyat.toLocaleString("tr-TR")} TL${oldWarning}</div>`;
    } else if (akakceLoading || queued) {
      const icon = akakceLoading ? "sync" : "hourglass_empty";
      const animClass = akakceLoading ? "status-icon-processing" : "status-icon-queued";
      const label = akakceLoading ? "Tarama..." : "Kuyrukta...";
      content = `<div style="font-size:11px; color:#3498DB; margin-top:2px; display:flex; align-items:center; gap:4px;"><span class="material-icons ${animClass}" style="font-size:12px !important;">${icon}</span><span style="font-size:10px">${label}</span></div>`;
    } else {
      content = `<div style="font-size:11px; color:transparent; margin-top:2px;">-</div>`; // Reserve space
    }

    if (akakceInfo.innerHTML !== content) {
      akakceInfo.innerHTML = content;
    }
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
            updateConfirmButtonState(products);
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

    updateButton.addEventListener("click", () => {
      updateButton.classList.add("loading");
      updateButton.classList.add("transforming"); // Immediate visual feedback

      const btnIcon = updateButton.querySelector(".material-icons");
      if (btnIcon) btnIcon.textContent = "sync";

      const progressBarContainer = document.getElementById("update-progress-container");
      if (progressBarContainer) progressBarContainer.style.display = "block";

      browser.runtime.sendMessage({ action: "START_FULL_UPDATE" })
        .then(() => {
          showToast("Güncelleme işlemi arkaplanda başlatıldı.", "info");
        })
        .catch(err => {
          console.error(err);
          showToast("Güncelleme başlatılamadı.", "error");
          updateButton.classList.remove("loading");
          updateButton.classList.remove("transforming");
        });
    });
  }

  if (searchBox) {
    searchBox.addEventListener("input", () => filterProductsByName(searchBox.value));
  }

  const pauseButton = document.getElementById("pause-button");
  const stopButton = document.getElementById("stop-button");

  if (pauseButton) {
    pauseButton.addEventListener("click", () => {
      browser.runtime.sendMessage({ action: "TOGGLE_PAUSE_UPDATE" }).then(res => {
        if (res && res.success) {
          const icon = pauseButton.querySelector(".material-icons");
          if (icon) icon.textContent = res.isPaused ? "play_arrow" : "pause";
        }
      });
    });
  }

  if (stopButton) {
    stopButton.addEventListener("click", () => {
      if (confirm("Güncellemeyi durdurmak istediğinize emin misiniz?")) {
        browser.runtime.sendMessage({ action: "STOP_UPDATE" }).then(() => {
          console.log("AFT: Güncelleme durduruldu.");
        });
      }
    });
  }

  // --- GÜNCELLEME DURUMU POLLING ---
  function pollUpdateStatus() {
    const fetchStatus = () => {
      browser.runtime.sendMessage({ action: "GET_UPDATE_STATUS" })
        .then(response => {
          if (response && response.state) {
            currentUpdateState = response.state;
            updateUIWithState(response.state);
          }
        })
        .catch(() => { });
    };

    fetchStatus(); // İlk açılışta hemen kontrol et
    setInterval(fetchStatus, 3000); // iGPU Optimization: Increased interval (1s -> 3s)
  }

  function updateUIWithState(state) {
    if (!state) return;

    // Sadece state değiştiyse işlem yap (İşlemci yükünü ve logları azaltır)
    const stateStr = JSON.stringify(state);
    if (stateStr === lastUpdateStateJson) return;
    lastUpdateStateJson = stateStr;

    // Log the change briefly
    if (state.isUpdating) {
      console.log(`AFT: Update Progress - Phase: ${state.phase}, Done: ${state.processedCount}/${state.totalCount}`);
    }

    if (!isListLoaded && state.isUpdating) {
      console.log("[DEBUG] List not loaded, skipping row updates");
      return;
    }

    if (isListLoaded && productsList.length === 0 && state.isUpdating && (state.totalCount > 0)) {
      console.log("AFT: List empty during update, forcing reload...");
      loadProductList();
      return;
    }

    const progressBarContainer = document.getElementById("update-progress-container");
    const updateButton = document.getElementById("update-button");
    const btnProgressFill = document.getElementById("button-progress-fill");
    const btnPhaseText = document.getElementById("button-phase-text");
    const updateControls = document.getElementById("update-controls");
    const pauseButtonIcon = document.querySelector("#pause-button .material-icons");

    if (!state || !state.isUpdating) {
      if (progressBarContainer) progressBarContainer.style.display = "none";
      updateButton.classList.remove("loading", "transforming");
      if (btnProgressFill) btnProgressFill.style.width = "0%";
      if (btnPhaseText) btnPhaseText.textContent = "";
      if (updateControls) updateControls.style.display = "none";

      if (preUpdateSortState) {
        activeSortState = preUpdateSortState.activeSortState;
        sortOrder = preUpdateSortState.sortOrder;
        preUpdateSortState = null;
        applySortAndRender();
      }

      document.querySelectorAll(".product-row").forEach(row => {
        row.classList.remove("queued", "processing", "processed");
        delete row.dataset.renderState; // Temizle
        const pId = row.getAttribute("data-id");
        Promise.all([getAllFromSync(pId), getProductFromDB(pId)]).then(([syncP, dbP]) => {
          if (syncP) updateRowUI({ ...syncP, ...dbP }, document.getElementById("product-tbody"));
        });
      });
      return;
    }

    if (!preUpdateSortState) {
      preUpdateSortState = {
        activeSortState: { ...activeSortState },
        sortOrder: sortOrder
      };
      applySortAndRender();
    }

    updateButton.classList.add("transforming");
    if (progressBarContainer) progressBarContainer.style.display = "block";
    if (updateControls) updateControls.style.display = "flex";
    if (pauseButtonIcon) pauseButtonIcon.textContent = state.isPaused ? "play_arrow" : "pause";

    const allRows = document.querySelectorAll(".product-row");
    allRows.forEach(row => {
      const pId = row.getAttribute("data-id");
      const priceCell = row.querySelector(".cell-price-new");
      const priceTextSpan = priceCell ? priceCell.querySelector("span:not(.sub-text)") : null;

      const isProcessing = state.processingIds.includes(pId);
      const isQueued = state.queueIds.includes(pId);
      const isProcessed = state.processedIds.includes(pId);

      row.classList.remove("processing", "queued", "processed");
      if (isProcessing) row.classList.add("processing");
      else if (isQueued) row.classList.add("queued");
      else if (isProcessed) row.classList.add("processed");

      // 1. Ana Fiyat Spinner Temizliği
      // Eğer ana fiyat yerinde spinner veya kum saati varsa AMA faz Amazon/HB değilse
      // veya ürün artık işlem görmüyorsa, normal fiyatı göstermek için yenile.
      const hasMainSpinner = priceTextSpan && (priceTextSpan.innerHTML.includes("sync") || priceTextSpan.innerHTML.includes("hourglass"));
      const shouldHaveMainSpinner = (state.phase === 'amazon' || state.phase === 'hb') && (isProcessing || isQueued);

      if (hasMainSpinner && !shouldHaveMainSpinner) {
        // Hemen düzelt
        refreshRowData(pId, state);
        return; // Bu satır için işlemi bitir
      }

      // 2. Faz Bazlı Görünüm Güncelleme
      // Gereksiz render'ı önlemek için dataset kontrolü yap
      const currentStateStr = `${state.phase}-${isProcessing ? 'proc' : ''}-${isQueued ? 'queue' : ''}-${isProcessed ? 'done' : ''}`;
      if (row.dataset.renderState === currentStateStr) return; // Zaten güncel

      if (state.phase === 'amazon' || state.phase === 'hb') {
        if (isProcessing) {
          if (priceTextSpan) priceTextSpan.innerHTML = '<span class="material-icons status-icon-processing">sync</span>';
          row.dataset.renderState = currentStateStr;
        } else if (isQueued) {
          if (priceTextSpan) priceTextSpan.innerHTML = '<span class="material-icons status-icon-queued">hourglass_empty</span>';
          row.dataset.renderState = currentStateStr;
        } else if (isProcessed) {
          // İşlendiği an güncelle
          refreshRowData(pId, state);
          row.dataset.renderState = currentStateStr;
        }
      } else if (state.phase === 'akakce') {
        if (isProcessing) {
          updateRowWithAkakceStatus(pId, { akakceLoading: true });
          row.dataset.renderState = currentStateStr;
        } else if (isQueued) {
          updateRowWithAkakceStatus(pId, { queued: true });
          row.dataset.renderState = currentStateStr;
        } else if (isProcessed) {
          // Bittiğinde temizle
          updateRowWithAkakceStatus(pId, {});
          row.dataset.renderState = currentStateStr;
        }
      }
    });

    applySortAndRender();

    // Progress Bar ve Buton Metni
    let percentage = state.totalCount > 0 ? (state.processedCount / state.totalCount) * 100 : 0;
    if (percentage > 100) percentage = 100;

    let phaseLabel = "";

    if (state.phase === 'amazon') {
      phaseLabel = `Amazon: ${state.processedCount}/${state.totalCount}${state.isPaused ? ' (Durduruldu)' : ''}`;
    } else if (state.phase === 'hb') {
      phaseLabel = `HB: ${state.processedCount}/${state.totalCount}${state.isPaused ? ' (Durduruldu)' : ''}`;
    } else if (state.phase === 'akakce') {
      const remaining = state.akakceQueueSize || 0;
      phaseLabel = `Akakçe: ${state.akakceQueueSize} kaldı${state.isPaused ? ' (Zzz)' : ''}`;
    }

    if (btnProgressFill) {
      btnProgressFill.style.width = `${percentage}%`;
      btnProgressFill.style.background = state.phase === 'akakce' ? '#f39c12' : '#3498db';
    }

    if (btnPhaseText) {
      btnPhaseText.textContent = phaseLabel;
      btnPhaseText.style.opacity = 1;
    }

    if (state.phase === 'error') {
      updateButton.classList.remove("transforming");
      if (btnPhaseText) btnPhaseText.textContent = "Hata!";
    }
  }

  function refreshRowData(pId, state) {
    const localP = productsList.find(p => p.id === pId);
    const options = {};
    if (state && state.phase === 'akakce') {
      if (state.processingIds.includes(pId)) options.akakceLoading = true;
      if (state.queueIds.includes(pId)) options.queued = true;
    }

    if (localP) {
      updateRowUI(localP, document.getElementById("product-tbody"), options);
    }

    Promise.all([getAllFromSync(pId), getProductFromDB(pId)]).then(([syncP, dbP]) => {
      if (syncP) {
        const combined = { ...syncP, ...dbP };
        const idx = productsList.findIndex(p => p.id === pId);
        if (idx !== -1) productsList[idx] = combined;
        updateRowUI(combined, document.getElementById("product-tbody"), options);
      }
    });
  }

  function updateRowWithAkakceStatus(pId, options) {
    const localP = productsList.find(p => p.id === pId);
    if (localP) {
      updateRowUI(localP, document.getElementById("product-tbody"), options);
    } else {
      Promise.all([getAllFromSync(pId), getProductFromDB(pId)]).then(([syncP, dbP]) => {
        if (syncP) {
          const combined = { ...syncP, ...dbP };
          updateRowUI(combined, document.getElementById("product-tbody"), options);
        }
      });
    }
  }


  // Başlangıçta durumu kontrol et
  pollUpdateStatus();

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
});