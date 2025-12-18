// popup > table.js
import { getAllFromSync, saveToSync, getAllFromDB, saveToDB, removeFromDB } from "./storage.js";
import { fetchProductData, renderChart } from "./chart.js";
import { updateBadgeCount } from "./update.js";
import { showToast } from "./notifications.js";
import { parsePrice, timeAgo } from "./price-utils.js"; // timeAgo buradan geliyor

let expandedRowIndex = null;

export async function renderProductList(products, productList, updateBadgeCount, updateState = null) {
  productList.textContent = "";

  if (!products.length) {
    productList.innerHTML = `
            <div class="product-row" style="justify-content: center; padding: 20px; box-shadow: none;">
                Henüz ürün takip edilmiyor.
            </div>`;
    updateBadgeCount(products);
    return;
  }

  products.forEach((product, index) => {
    productList.appendChild(createProductRow(product, index, toggleAccordion, updateBadgeCount, productList, updateState));
  });

  updateBadgeCount(products);
}

document.addEventListener("click", (event) => {
  document.querySelectorAll(".group-menu").forEach((menu) => {
    if (!menu.contains(event.target) && !menu.parentElement.contains(event.target)) {
      menu.style.display = "none";
    }
  });
});

export function createProductRow(product, index, toggleAccordion, updateBadgeCount, productList, updateState = null) {

  const productRow = document.createElement("div");
  productRow.className = "product-row";
  productRow.dataset.id = product.id;

  // Güncelleme durumunu hemen uygula (Flicker engelleme)
  if (updateState && updateState.isUpdating) {
    if (updateState.processingIds && updateState.processingIds.includes(product.id)) {
      productRow.classList.add("processing");
    } else if (updateState.queueIds && updateState.queueIds.includes(product.id)) {
      productRow.classList.add("queued");
    } else if (updateState.processedIds && updateState.processedIds.includes(product.id)) {
      productRow.classList.add("processed");
    }
  }

  // 1. ACTION CELL (New Refresh Button Location)
  const actionCell = document.createElement("div");
  actionCell.className = "cell-actions";

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "icon-btn refresh-btn-premium";
  refreshBtn.title = "Sadece bu ürünü güncelle";
  refreshBtn.innerHTML = '<span class="material-icons" style="font-size: 18px;">sync</span>';
  refreshBtn.onclick = async (e) => {
    e.stopPropagation();
    refreshBtn.classList.add("rotating");
    refreshBtn.disabled = true;

    try {
      const { updateProductPrice } = await import('./update.js');
      const updatedProduct = await updateProductPrice(product, true);

      // DOM Update
      const row = productList.querySelector(`.product-row[data-id="${product.id}"]`);
      if (row) {
        const newPriceCell = row.querySelector(".cell-price-new");
        const statusCell = row.querySelector(".cell-status");
        const statusText = statusCell.querySelector("span");

        if (newPriceCell) {
          const priceText = newPriceCell.querySelector("span:not(.sub-text)");
          if (priceText) {
            priceText.textContent = (updatedProduct.newPrice || "-").replace("TL", " TL");
            const oldP = parsePrice(updatedProduct.oldPrice);
            const newP = parsePrice(updatedProduct.newPrice);
            priceText.style.color = !oldP ? "#3498DB" : newP < oldP ? "#2ECC71" : newP > oldP ? "#E74C3C" : "";
          }

          // Akakçe update
          const existingAkakce = newPriceCell.querySelector("div[style*='color: rgb(52, 152, 219)']");
          if (existingAkakce) existingAkakce.remove();

          if (updatedProduct.akakceHistory && updatedProduct.akakceHistory.length > 0) {
            const latest = updatedProduct.akakceHistory[updatedProduct.akakceHistory.length - 1];
            const akakceDiv = document.createElement("div");
            akakceDiv.style.fontSize = "11px";
            akakceDiv.style.color = "#3498DB";
            akakceDiv.style.marginTop = "2px";

            let contentHTML = `<span style="font-weight:600">Akakçe:</span> ${latest.fiyat.toLocaleString("tr-TR")} TL`;
            if (updatedProduct.akakceUrl) {
              contentHTML = `<a href="${updatedProduct.akakceUrl}" target="_blank" style="text-decoration:none; color:inherit;">${contentHTML}</a>`;
            }
            akakceDiv.innerHTML = contentHTML;

            const subText = newPriceCell.querySelector(".sub-text");
            if (subText) newPriceCell.insertBefore(akakceDiv, subText);
            else newPriceCell.appendChild(akakceDiv);
          }
        }

        if (statusText) {
          if (updatedProduct.status === "Stokta Yok") statusText.textContent = "Stok Yok";
          else statusText.textContent = updatedProduct.status || "";
        }
      }

      showToast("Ürün güncellendi!", "success");
    } catch (err) {
      console.error("Tekil güncelleme hatası:", err);
    } finally {
      refreshBtn.classList.remove("rotating");
      refreshBtn.disabled = false;
    }
  };
  actionCell.appendChild(refreshBtn);
  productRow.appendChild(actionCell);

  // 2. IMAGE CELL (Moved before Group)
  const imageCell = document.createElement("div");
  imageCell.className = "cell-image";
  const previewImg = document.createElement("img");
  previewImg.className = "preview-img";

  if (product.picUrl) {
    previewImg.src = product.picUrl;
  } else {
    previewImg.src = "";
    previewImg.classList.add("no-image");
  }

  imageCell.appendChild(previewImg);
  productRow.appendChild(imageCell);

  // 3. GROUP CELL
  const groupCell = document.createElement("div");
  groupCell.className = "cell-group";
  groupCell.style.position = "relative";
  groupCell.style.backgroundColor = "transparent"; // Click helper

  const groups = ["🔴", "🟡", "🟢"];
  product.group = product.group || "";
  groupCell.textContent = groups.includes(product.group) ? product.group : "";

  const groupMenu = document.createElement("div");
  groupMenu.className = "group-menu";
  groups.forEach((group) => {
    const option = document.createElement("div");
    option.textContent = group;
    option.className = "group-menu-option";
    option.onclick = async () => {
      const newGroup = product.group === group ? "" : group;
      groupCell.textContent = newGroup || "";
      groupMenu.style.display = "none";

      try {
        const productsFromSync = await getAllFromSync();
        const i = productsFromSync.findIndex((p) => p.id === product.id);
        if (i >= 0) {
          productsFromSync[i].group = newGroup;
          await saveToSync(productsFromSync);
        }

        await saveToDB([{ id: product.id, group: newGroup }]);

        const { applySortAndRender } = await import('./popup.js');
        await applySortAndRender({ forceFetch: true });

      } catch (e) {
        showToast("Hata oluştu.", "error");
        groupCell.textContent = product.group;
      }
    };
    groupMenu.appendChild(option);
  });
  groupCell.onclick = (e) => {
    e.stopPropagation();
    // Diğer menüleri kapat
    document.querySelectorAll(".group-menu").forEach(m => {
      if (m !== groupMenu) m.style.display = "none";
    });

    groupMenu.style.left = "0px";
    groupMenu.style.top = "30px"; // Sola ve aşağıya sabitle (relative ebeveyne göre)
    groupMenu.style.display = groupMenu.style.display === "block" ? "none" : "block";
  };
  groupCell.appendChild(groupMenu);
  productRow.appendChild(groupCell);

  // 4. NAME CELL (No number cell anymore)
  const nameCell = document.createElement("div");
  nameCell.className = "cell-name";
  nameCell.style.display = "flex";
  nameCell.style.flexDirection = "column";
  nameCell.style.alignItems = "flex-start";
  nameCell.style.justifyContent = "center";

  const link = document.createElement("a");
  link.href = product.url;
  link.target = "_blank";
  link.textContent = product.name;
  link.title = product.name;
  nameCell.appendChild(link);

  // Eklenme Tarihi
  if (product.date) {
    const dateSpan = document.createElement("span");
    dateSpan.className = "sub-text";
    dateSpan.textContent = `📅 ${product.date}`;
    nameCell.appendChild(dateSpan);
  }
  productRow.appendChild(nameCell);

  // Old Price Cell
  const oldPriceCell = document.createElement("div");
  oldPriceCell.className = "cell-price-old";
  oldPriceCell.textContent = product.oldPrice ? product.oldPrice.replace("TL", " TL") : "";
  productRow.appendChild(oldPriceCell);

  // Previous Price Cell
  const prevPriceCell = document.createElement("div");
  prevPriceCell.className = "cell-price-prev";

  if (product.previousPrice) {
    const pSpan = document.createElement("span");
    pSpan.textContent = product.previousPrice.replace("TL", " TL");
    prevPriceCell.appendChild(pSpan);

    const prevP = parsePrice(product.previousPrice);
    const currP = parsePrice(product.newPrice);

    if (!isNaN(prevP) && !isNaN(currP) && prevP > 0) {
      const diff = currP - prevP;
      // Sadece fark varsa ve anlamlıysa göster
      if (Math.abs(diff) > 0.01) {
        const ratio = (diff / prevP) * 100;
        const sub = document.createElement("span");
        sub.className = "sub-text";
        sub.style.fontWeight = "bold";
        sub.textContent = `${ratio > 0 ? '+' : ''}${ratio.toFixed(0)}%`;
        // Zam (Artış) -> Kırmızı (#E74C3C), İndirim (Azalış) -> Yeşil (#2ECC71)
        sub.style.color = ratio > 0 ? "#E74C3C" : "#2ECC71";
        prevPriceCell.appendChild(sub);
      }
    }
  } else {
    prevPriceCell.textContent = "-";
  }
  productRow.appendChild(prevPriceCell);

  // Percent Cell
  const percentCell = document.createElement("div");
  percentCell.className = "cell-percent";

  const oldP = parsePrice(product.oldPrice);
  const newP = parsePrice(product.newPrice);

  if (!isNaN(oldP) && !isNaN(newP) && oldP > 0 && newP > 0) {
    if (oldP !== newP) {
      const percentChange = ((newP - oldP) / oldP) * 100;
      percentCell.textContent = `${percentChange > 0 ? '+' : ''}${percentChange.toFixed(0)}%`;
      percentCell.classList.add(percentChange > 0 ? "positive" : "negative");
    } else {
      percentCell.textContent = "0%";
    }
  }
  else if (!isNaN(oldP) && (product.status === null || product.status === "🟰" || product.status === "✅")) {
    percentCell.textContent = "0%";
  }
  else {
    percentCell.textContent = "-";
  }
  productRow.appendChild(percentCell);

  // New Price Cell
  const newPriceCell = document.createElement("div");
  newPriceCell.className = "cell-price-new";
  newPriceCell.style.display = "flex";
  newPriceCell.style.flexDirection = "column";
  newPriceCell.style.justifyContent = "center";

  const priceText = document.createElement("span");
  const { oldPrice, newPrice } = product;

  if (["➕", "⬇️", "⬆️"].includes(product.status)) {
    newPriceCell.classList.add('price-flash');
  }

  if (newPrice) {
    const oldP_ = parsePrice(oldPrice);
    const newP_ = parsePrice(newPrice);

    if (oldP_ > 0 && newP_ > 0 && oldP_ !== newP_) {
      oldPriceCell.style.textDecoration = "line-through";
    }

    priceText.style.color = !oldP_ ? "#3498DB" : newP_ < oldP_ ? "#2ECC71" : newP_ > oldP_ ? "#E74C3C" : "";
    priceText.textContent = newPrice.replace("TL", " TL");
  }
  newPriceCell.appendChild(priceText);

  // Akakçe Fiyat Gösterimi Konteynırı (Gelişmiş & Sabit)
  const akakceContainer = document.createElement("div");
  akakceContainer.className = "akakce-info-container";
  akakceContainer.style.minHeight = "18px"; // Yükseklik zıplamasını önlemek için

  if (product.akakceHistory && product.akakceHistory.length > 0) {
    const latest = product.akakceHistory.reduce((prev, current) =>
      (new Date(prev.tarih) > new Date(current.tarih)) ? prev : current
    );
    const diffDays = Math.floor((new Date() - new Date(latest.tarih)) / (1000 * 60 * 60 * 24));
    const oldWarning = diffDays > 3 ? ` (${diffDays}g önce)` : '';
    let html = `<span style="font-weight:600">Akakçe:</span> ${latest.fiyat.toLocaleString("tr-TR")} TL${oldWarning}`;
    if (product.akakceUrl) {
      html = `<a href="${product.akakceUrl}" target="_blank" style="text-decoration:none; color:inherit;">${html}</a>`;
    }
    akakceContainer.innerHTML = `<div style="font-size:11px; color:#3498DB; margin-top:2px;">${html}</div>`;
  } else {
    akakceContainer.innerHTML = `<div style="font-size:11px; color:transparent; margin-top:2px;">-</div>`;
  }
  newPriceCell.appendChild(akakceContainer);

  // Son Değişim Zamanı (timeAgo fonksiyonu kullanılıyor)
  const changeSpan = document.createElement("span");
  changeSpan.className = "sub-text";
  const ago = timeAgo(product.lastChangeDate);
  changeSpan.textContent = ago ? `🕒 ${ago}` : "Değişim: -";
  if (product.lastChangeDate) {
    changeSpan.title = new Date(product.lastChangeDate).toLocaleString("tr-TR");
  }
  newPriceCell.appendChild(changeSpan);

  productRow.appendChild(newPriceCell);

  // Status Cell
  const statusCell = document.createElement("div");
  statusCell.className = "cell-status";
  statusCell.style.display = "flex";
  statusCell.style.alignItems = "center";
  statusCell.style.justifyContent = "space-between";

  const statusText = document.createElement("span");
  if (product.status === "Stokta Yok") {
    statusText.textContent = "Stok Yok";
  } else {
    statusText.textContent = product.status || "";
  }
  statusCell.appendChild(statusText);

  // refresh button removed from here

  const statusTitles = {
    "➕": "Ürün stoğa girdi",
    "⬆️": "Zam geldi",
    "⬇️": "İndirim geldi",
    "‼️": "Hata",
    "Stokta Yok": "Stokta Yok",
    "🟰": "Fiyat değişmedi",
    "✅": "Kontrol edildi"
  };
  statusCell.title = statusTitles[statusText.textContent] || "";

  // Chevron remains in status cell for accordion
  const chartIcon = document.createElement("span");
  chartIcon.className = "material-icons chart-chevron-icon";
  chartIcon.textContent = "expand_more";
  chartIcon.style.marginLeft = "auto"; // Push directly to right if flex
  statusCell.appendChild(chartIcon);

  // click event moved below...

  statusCell.onclick = async () => {
    if (["➕", "⬆️", "⬇️"].includes(product.status)) {
      const newOldPrice = product.newPrice;
      const newNewPrice = null;
      const newStatus = null;

      try {
        const productsFromSync = await getAllFromSync();
        const i = productsFromSync.findIndex((p) => p.id === product.id);
        if (i >= 0) {
          productsFromSync[i].oldPrice = newOldPrice;
          productsFromSync[i].newPrice = newNewPrice;
          productsFromSync[i].status = newStatus;
          await saveToSync(productsFromSync);
        }
        await saveToDB([{ id: product.id, oldPrice: newOldPrice, newPrice: newNewPrice, status: newStatus }]);

        const allDataFromDB = await getAllFromDB();
        const allDataFromSync = await getAllFromSync();
        const dbMap = new Map(allDataFromDB.map(item => [item.id, item]));
        const mergedData = allDataFromSync.map(p => ({ ...p, ...(dbMap.get(p.id) || {}) }));
        const sortedData = mergedData.sort((a, b) => (a.no || Infinity) - (b.no || Infinity));

        renderProductList(sortedData, productList, updateBadgeCount);
        showToast("Fiyat onaylandı.", "success");
      } catch (error) {
        showToast("Durum güncellerken hata oluştu.", "error");
      }
    }
  };
  productRow.appendChild(statusCell);

  // Delete Cell
  const deleteCell = document.createElement("div");
  deleteCell.className = "cell-actions";
  const deleteButton = document.createElement("button");
  deleteButton.className = "delete-btn";
  deleteButton.title = "Ürünü Sil";
  deleteButton.innerHTML = "<span>&times;</span>";
  deleteButton.onclick = () => removeProduct(product.id, productList, updateBadgeCount);
  deleteCell.appendChild(deleteButton);
  productRow.appendChild(deleteCell);

  productRow.addEventListener("click", (e) => {
    if (e.target.closest(".delete-btn, .cell-group, .cell-name a, .cell-status")) {
      if (e.target.closest(".cell-status") && !e.target.closest(".cell-status span.material-icons")) {
      } else if (e.target.closest(".cell-name a, .cell-group, .delete-btn")) {
        return;
      }
    }
    toggleAccordion(index, product, productList);
  });
  return productRow;
}

export function toggleAccordion(index, product, productList) {
  const existingAccordion = document.querySelector(".accordion-row");
  const chartIcon = productList.querySelector(`div[data-id="${product.id}"] .chart-chevron-icon`);

  document.querySelectorAll(".chart-chevron-icon").forEach(icon => icon.textContent = "expand_more");

  if (existingAccordion) {
    existingAccordion.remove();
    if (expandedRowIndex === index) {
      if (chartIcon) chartIcon.textContent = "expand_more";
      expandedRowIndex = null;
      return;
    }
  }

  fetchProductData(product.id)
    .then((data) => {
      const productRow = productList.querySelector(`div[data-id="${product.id}"]`);
      if (!productRow) return;

      const accordion = document.createElement("div");
      accordion.className = "accordion-row";

      const cell = document.createElement("div");
      cell.style.gridColumn = "1 / -1";
      cell.className = "accordion-content-wrapper";

      const content = document.createElement("div");
      content.className = "accordion-content";

      const chartDiv = document.createElement("div");
      chartDiv.id = `chart-${index}`;
      chartDiv.style.width = "100%";

      const noData = document.createElement("div");
      noData.id = `no-data-${index}`;
      noData.className = "no-data-message";
      noData.textContent = "Veri oluşturma isteği gönderilmiştir.";
      noData.style = "display: none; text-align: center;";

      const disclaimer = document.createElement("div");
      disclaimer.className = "chart-disclaimer";
      disclaimer.textContent = "Grafik verileri, Yanyo (yaniyo.com) ve AFT sunucuları tarafından sağlanmaktadır.";

      // AKAKÇE BUTTON & CHART
      // AKAKÇE BUTTON (Graph merged into main chart)
      const akakceBtn = document.createElement("button");
      akakceBtn.className = "action-button";
      akakceBtn.style.marginTop = "15px";
      akakceBtn.style.width = "100%";
      akakceBtn.style.backgroundColor = "#2d3436"; // Akakçe dark gray
      akakceBtn.innerHTML = '<span class="material-icons" style="vertical-align: middle; font-size: 16px;">search</span> Akakçe Fiyat Geçmişini Getir';

      akakceBtn.onclick = async () => {
        akakceBtn.disabled = true;
        akakceBtn.innerHTML = '<span class="material-icons rotating" style="vertical-align: middle; font-size: 16px;">sync</span> Akakçe taranıyor... (Arkaplanda)';

        try {
          const response = await browser.runtime.sendMessage({
            action: "SEARCH_AND_SCRAPE_AKAKCE_HISTORY",
            productName: product.name
          });

          akakceBtn.disabled = false;

          if (response && response.success) {

            if (response.data && response.data.length > 0) {
              const formattedAkakceData = response.data.map(d => {
                const rawDate = d.tarih || d.date;
                const price = d.fiyat || d.price;
                let dateStr = rawDate;
                if (rawDate) {
                  try {
                    const dateObj = new Date(rawDate);
                    dateStr = dateObj.toISOString().split('T')[0];
                  } catch (e) { dateStr = rawDate; }
                }
                return { tarih: dateStr, fiyat: price };
              });

              // 1. Veriyi Kaydet (Cache)
              try {
                const productsFromDB = await getAllFromDB();
                const i = productsFromDB.findIndex(p => p.id === product.id);
                if (i >= 0) {
                  productsFromDB[i].akakceHistory = formattedAkakceData;
                  if (response.productUrl) {
                    productsFromDB[i].akakceUrl = response.productUrl;
                  }
                  await saveToDB(productsFromDB);
                } else {
                  // Eğer DB'de yoksa (sync only?), DB'ye eklemeyi deneyebiliriz ama şimdilik sadece mevcut kaydı güncelliyoruz.
                  // Veya sadece bellekte tutup render edebiliriz.
                }
              } catch (e) { console.error("Akakçe verisi kaydedilemedi", e); }

              // 2. Grafiği Tekrar Çiz (Birleştirilmiş Veri ile)
              // Mevcut data (Amazon/Yanyo) + Yeni Akakçe verisi
              renderChart(`chart-${index}`, [
                { name: 'Amazon' + (data && data.length > 0 ? '' : ''), data: data, color: '#FF9900' },
                { name: 'Akakçe', data: formattedAkakceData, color: '#3498DB' }
              ]);

            } else if (response.summary) {
              // Highcharts yok ama özet bilgi var
              // Bunu nasıl göstereceğiz? Ayrı bir div açabiliriz veya toast atabiliriz.
              // Şimdilik toast ile idare edelim veya buton metnini değiştirip bırakalım.
              showToast(`Özet: Min ${response.summary.low} / Max ${response.summary.high}`, "info");
            } else if (response.currentPrice) {
              showToast(`Güncel Akakçe Fiyatı: ${response.currentPrice}`, "info");
            } else {
              showToast("Grafik veya fiyat verisi bulunamadı.", "error");
            }

            akakceBtn.style.display = "none";
            if (response.data && response.data.length > 0) showToast("Akakçe verileri başarıyla yüklendi", "success");
          } else {
            showToast(response ? (response.error || "Hata oluştu") : "Yanıt yok", "error");
            akakceBtn.innerHTML = '<span class="material-icons" style="vertical-align: middle; font-size: 16px;">error</span> Tekrar Dene';
          }
        } catch (error) {
          console.error("Akakçe isteği hatası:", error);
          akakceBtn.disabled = false;
          akakceBtn.innerHTML = '<span class="material-icons" style="vertical-align: middle; font-size: 16px;">error</span> Hata Oluştu';
          showToast("İletişim hatası: " + error.message, "error");
        }
      };

      content.append(chartDiv, noData, disclaimer, akakceBtn);
      cell.appendChild(content);
      accordion.appendChild(cell);
      productRow.insertAdjacentElement("afterend", accordion);

      if (data && Array.isArray(data) && data.length > 0) {
        // DB'den Akakçe verisi de var mı kontrol et
        getAllFromDB().then(dbProducts => {
          const stored = dbProducts.find(p => p.id === product.id);
          if (stored && stored.akakceHistory && stored.akakceHistory.length > 0) {
            // Hem Amazon hem Akakçe verisi var, birleştirip çiz
            renderChart(`chart-${index}`, [
              { name: 'Amazon', data: data, color: '#FF9900' },
              { name: 'Akakçe', data: stored.akakceHistory, color: '#3498DB' }
            ]);
            // Butonu gizle çünkü veri zaten var
            akakceBtn.style.display = "none";
          } else {
            // Sadece Amazon verisi var
            renderChart(`chart-${index}`, [
              { name: 'Amazon', data: data, color: '#FF9900' }
            ]);
          }
        });
      } else {
        noData.style.display = "block";
        noData.textContent = "Grafik verisi bulunamadı. Veri toplama isteği gönderilmiştir.";
      }

      if (chartIcon) {
        chartIcon.textContent = "expand_less";
      }

      expandedRowIndex = index;
    })
    .catch((error) => {
      console.error("Grafik verisi alınırken hata:", error);
      showToast("Veri alınırken hata oluştu.", "error");

      if (chartIcon) {
        chartIcon.textContent = "expand_more";
      }
      if (document.querySelector(".accordion-row")) {
        document.querySelector(".accordion-row").remove();
      }
      expandedRowIndex = null;
    });
}

export async function removeProduct(id, productList, updateBadgeCount) {
  try {
    await removeFromSync(id);
    await removeFromDB(id); // Hem Sync hem DB'den sil

    const productsFromSync = await getAllFromSync();
    let productsFromDB = await getAllFromDB();

    // Sıralamayı düzelt
    productsFromDB.sort((a, b) => (a.no || Infinity) - (b.no || Infinity));
    const reorderedDBItems = productsFromDB.map((o, index) => ({ ...o, no: index + 1 }));

    await saveToDB(reorderedDBItems);

    const dbDataMap = new Map(reorderedDBItems.map(item => [item.id, item]));
    const mergedData = productsFromSync.map(product => ({
      ...product,
      ...(dbDataMap.get(product.id) || {})
    }));

    const sortedData = mergedData.sort((a, b) => (a.no || Infinity) - (b.no || Infinity));
    renderProductList(sortedData, productList, updateBadgeCount);

    showToast("Ürün listeden silindi.", "success");

  } catch (error) {
    console.error("Ürün silinirken hata:", error);
    showToast("Ürünü silerken hata oluştu.", "error");
  }
}