// popup > table.js
import { getAllFromSync, saveToSync, getAllFromDB, saveToDB, removeFromDB, removeFromSync } from "./storage.js";
import { fetchProductData, renderChart } from "./chart.js";
import { updateBadgeCount } from "./update.js";
import { showToast } from "./notifications.js";
import { parsePrice, timeAgo } from "./price-utils.js"; // timeAgo buradan geliyor

let expandedRowIndex = null;

export async function renderProductList(products, productList, updateBadgeCount, updateState = null) {
  productList.textContent = "";

  if (!products.length) {
    productList.innerHTML = `
            <div class="empty-state">
                <div class="abstract-orb"></div>
                <h2>Henüz Ürün Yok</h2>
                <p>Amazon veya Hepsiburada'dan bir ürün linki yapıştırarak takibe başlayabilirsin.</p>
                <button class="cta-button" id="empty-state-add">İlk Ürünü Ekle</button>
            </div>`;

    // YENİ: Boş durumdaki butona tıklama özelliği
    productList.querySelector("#empty-state-add")?.addEventListener("click", () => {
      document.getElementById("add-product-button")?.click();
    });

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
  productRow.style.setProperty("--i", index);
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

  // 1. ACTION CELL (Refresh)
  productRow.appendChild(createActionCell(product, productList));

  // 2. IMAGE CELL
  productRow.appendChild(createImageCell(product));

  // 3. GROUP CELL
  productRow.appendChild(createGroupCell(product, productList, updateBadgeCount));

  // 4. NAME CELL
  productRow.appendChild(createNameCell(product));

  // 5. OLD PRICE CELL
  productRow.appendChild(createOldPriceCell(product));

  // 6. PREVIOUS PRICE CELL
  productRow.appendChild(createPrevPriceCell(product));

  // 7. PERCENT CELL
  productRow.appendChild(createPercentCell(product));

  // 8. NEW PRICE CELL
  productRow.appendChild(createNewPriceCell(product));

  // 9. STATUS CELL
  productRow.appendChild(createStatusCell(product, productList, updateBadgeCount, index));

  // 10. DELETE CELL
  productRow.appendChild(createDeleteCell(product.id, productList, updateBadgeCount));

  // Row Click for Accordion
  productRow.addEventListener("click", (e) => {
    if (e.target.closest(".delete-btn, .cell-group, .cell-name a, .cell-status")) {
      // Status hücresinde fiyata onay verme işlemi varsa veya linke tıklandıysa accordion açma
      if (e.target.closest(".cell-status") && !e.target.closest(".cell-status .chart-chevron-icon")) {
        // Ok ikonuna basılmadıysa ama status hücresine basıldıysa (fiyat onayı) açma
      } else if (e.target.closest(".cell-name a, .cell-group, .delete-btn")) {
        return;
      }
    }
    toggleAccordion(index, product, productList);
  });

  return productRow;
}

/**
 * Helper: Name Cell
 */
function createNameCell(product) {
  const nameCell = document.createElement("div");
  nameCell.className = "cell-name";
  nameCell.style.display = "flex";
  nameCell.style.flexDirection = "column";

  const link = document.createElement("a");
  link.href = product.url;
  link.target = "_blank";
  link.textContent = product.name;
  link.title = product.name;
  nameCell.appendChild(link);

  if (product.date) {
    const dateSpan = document.createElement("span");
    dateSpan.className = "sub-text";
    dateSpan.textContent = `📅 ${product.date}`;
    nameCell.appendChild(dateSpan);
  }
  return nameCell;
}

/**
 * Helper: Old Price Cell
 */
function createOldPriceCell(product) {
  const oldPriceCell = document.createElement("div");
  oldPriceCell.className = "cell-price-old";
  oldPriceCell.textContent = product.oldPrice ? product.oldPrice.replace("TL", " TL") : "";
  return oldPriceCell;
}

/**
 * Helper: Previous Price Cell
 */
function createPrevPriceCell(product) {
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
      if (Math.abs(diff) > 0.01) {
        const ratio = (diff / prevP) * 100;
        const sub = document.createElement("span");
        sub.className = "sub-text";
        sub.style.fontWeight = "bold";
        sub.textContent = `${ratio > 0 ? '+' : ''}${ratio.toFixed(0)}%`;
        sub.style.color = ratio > 0 ? "#f43f5e" : "#10b981";
        prevPriceCell.appendChild(sub);
      }
    }
  } else {
    prevPriceCell.textContent = "-";
  }
  return prevPriceCell;
}

/**
 * Helper: Percent Cell
 */
function createPercentCell(product) {
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
  } else if (!isNaN(oldP) && ["🟰", "✅"].includes(product.status)) {
    percentCell.textContent = "0%";
  } else {
    percentCell.textContent = "-";
  }
  return percentCell;
}

/**
 * Helper: New Price Cell
 */
function createNewPriceCell(product) {
  const newPriceCell = document.createElement("div");
  newPriceCell.className = "cell-price-new";
  newPriceCell.style.display = "flex";
  newPriceCell.style.flexDirection = "column";

  const priceText = document.createElement("span");
  const { oldPrice, newPrice } = product;

  if (["➕", "⬇️", "⬆️"].includes(product.status)) {
    newPriceCell.classList.add('price-flash');
  }

  if (newPrice) {
    const oldP = parsePrice(oldPrice);
    const newP = parsePrice(newPrice);
    priceText.style.color = !oldP ? "#3b82f6" : newP < oldP ? "#10b981" : newP > oldP ? "#f43f5e" : "";
    priceText.textContent = newPrice.replace("TL", " TL");
  } else {
    priceText.textContent = "-";
  }
  newPriceCell.appendChild(priceText);

  // Akakçe Info
  const akakceContainer = document.createElement("div");
  akakceContainer.className = "akakce-info-container";
  akakceContainer.style.minHeight = "18px";

  if (product.akakceHistory && product.akakceHistory.length > 0) {
    const latest = product.akakceHistory.reduce((prev, curr) => (new Date(prev.tarih) > new Date(curr.tarih)) ? prev : curr);
    const diffDays = Math.floor((new Date() - new Date(latest.tarih)) / (1000 * 60 * 60 * 24));
    const oldWarning = diffDays > 3 ? ` (${diffDays}g önce)` : '';
    let html = `<span style="font-weight:600">Akakçe:</span> ${latest.fiyat.toLocaleString("tr-TR")} TL${oldWarning}`;
    if (product.akakceUrl) {
      html = `<a href="${product.akakceUrl}" target="_blank" style="text-decoration:none; color:inherit;">${html}</a>`;
    }
    akakceContainer.innerHTML = `<div style="font-size:11px; color:#3b82f6; margin-top:2px;">${html}</div>`;
  } else {
    akakceContainer.innerHTML = `<div style="font-size:11px; color:transparent; margin-top:2px;">-</div>`;
  }
  newPriceCell.appendChild(akakceContainer);

  const changeSpan = document.createElement("span");
  changeSpan.className = "sub-text";
  const ago = timeAgo(product.lastChangeDate);
  changeSpan.textContent = ago ? `🕒 ${ago}` : "Değişim: -";
  if (product.lastChangeDate) {
    changeSpan.title = new Date(product.lastChangeDate).toLocaleString("tr-TR");
  }
  newPriceCell.appendChild(changeSpan);

  return newPriceCell;
}

/**
 * Helper: Status Cell
 */
function createStatusCell(product, productList, updateBadgeCount, index) {
  const statusCell = document.createElement("div");
  statusCell.className = "cell-status";
  statusCell.style.display = "flex";
  statusCell.style.alignItems = "center";
  statusCell.style.justifyContent = "space-between";

  const statusText = document.createElement("span");
  const rawStatus = product.status || "";
  statusText.textContent = rawStatus === "Stokta Yok" ? "Stok Yok" : rawStatus;

  // Apply Pill Styling
  statusText.className = "status-pill";
  if (rawStatus === "➕") {
    statusText.classList.add("plus");
    statusText.textContent = "STOKTA";
  } else if (rawStatus === "⬇️") {
    statusText.classList.add("down");
    statusText.textContent = "İNDİRİM";
  } else if (rawStatus === "⬆️") {
    statusText.classList.add("up");
    statusText.textContent = "ZAM";
  } else if (rawStatus === "✅") {
    statusText.classList.add("none");
    statusText.innerHTML = '<span class="material-icons" style="font-size: 14px;">check_circle</span>';
    statusText.style.padding = "4px";
  } else {
    statusText.style.display = "none";
  }

  statusCell.appendChild(statusText);

  const statusTitles = {
    "➕": "Ürün stoğa girdi",
    "⬆️": "Zam geldi",
    "⬇️": "İndirim geldi",
    "‼️": "Hata",
    "Stokta Yok": "Stokta Yok",
    "🟰": "Fiyat değişmedi",
    "✅": "Kontrol edildi"
  };
  statusCell.title = statusTitles[rawStatus] || "";

  const chartIcon = document.createElement("span");
  chartIcon.className = "material-icons chart-chevron-icon";
  chartIcon.textContent = "expand_more";
  chartIcon.style.marginLeft = "auto";
  statusCell.appendChild(chartIcon);

  // Status Click (Approve Price Change)
  statusCell.onclick = async (e) => {
    if (["➕", "⬆️", "⬇️"].includes(product.status)) {
      e.stopPropagation();
      const newOldPrice = product.newPrice;
      const newNewPrice = null;
      const newStatus = "✅";

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

        const { applySortAndRender } = await import('./popup.js');
        await applySortAndRender({ forceFetch: true });
        showToast("Fiyat onaylandı.", "success");
      } catch (error) {
        showToast("Hata oluştu.", "error");
      }
    }
  };

  return statusCell;
}

/**
 * Helper: Delete Cell
 */
function createDeleteCell(productId, productList, updateBadgeCount) {
  const deleteCell = document.createElement("div");
  deleteCell.className = "cell-actions";
  const deleteButton = document.createElement("button");
  deleteButton.className = "delete-btn";
  deleteButton.title = "Ürünü Sil";
  deleteButton.innerHTML = "<span>&times;</span>";
  deleteButton.onclick = (e) => {
    e.stopPropagation();
    removeProduct(productId, productList, updateBadgeCount);
  };
  deleteCell.appendChild(deleteButton);
  return deleteCell;
}

/**
 * Helper: Action Cell (Refresh)
 */
function createActionCell(product, productList) {
  const actionCell = document.createElement("div");
  actionCell.className = "cell-action-left";

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "refresh-btn-premium";
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
        const statusText = statusCell ? statusCell.querySelector("span") : null;

        if (newPriceCell) {
          const priceText = newPriceCell.querySelector("span:not(.sub-text)");
          if (priceText) {
            priceText.textContent = (updatedProduct.newPrice || "-").replace("TL", " TL");
            const oldP = parsePrice(updatedProduct.oldPrice);
            const newP = parsePrice(updatedProduct.newPrice);
            priceText.style.color = !oldP ? "#3b82f6" : newP < oldP ? "#10b981" : newP > oldP ? "#f43f5e" : "";
          }

          const existingAkakce = newPriceCell.querySelector(".akakce-info-container");
          if (existingAkakce) {
            if (updatedProduct.akakceHistory && updatedProduct.akakceHistory.length > 0) {
              const latest = updatedProduct.akakceHistory[updatedProduct.akakceHistory.length - 1];
              let html = `<span style="font-weight:600">Akakçe:</span> ${latest.fiyat.toLocaleString("tr-TR")} TL`;
              if (updatedProduct.akakceUrl) {
                html = `<a href="${updatedProduct.akakceUrl}" target="_blank" style="text-decoration:none; color:inherit;">${html}</a>`;
              }
              existingAkakce.innerHTML = `<div style="font-size:11px; color:#3b82f6; margin-top:2px;">${html}</div>`;
            }
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
  return actionCell;
}

/**
 * Helper: Image Cell
 */
function createImageCell(product) {
  const imageCell = document.createElement("div");
  imageCell.className = "cell-image";

  const imgWrapper = document.createElement("div");
  imgWrapper.className = "img-wrapper";

  const previewImg = document.createElement("img");
  previewImg.className = "preview-img";

  if (product.picUrl) {
    previewImg.src = product.picUrl;
  } else {
    previewImg.src = "";
    previewImg.classList.add("no-image");
  }

  imgWrapper.appendChild(previewImg);
  imageCell.appendChild(imgWrapper);
  return imageCell;
}

/**
 * Helper: Group Cell
 */
function createGroupCell(product, productList, updateBadgeCount) {
  const groupCell = document.createElement("div");
  groupCell.className = "cell-group";
  groupCell.style.position = "relative";

  const groupDisplay = document.createElement("span");
  groupDisplay.className = "group-display";
  const groups = ["🔴", "🟡", "🟢"];
  const currentGroup = product.group || "";
  groupDisplay.textContent = groups.includes(currentGroup) ? currentGroup : "";
  groupCell.appendChild(groupDisplay);

  const groupMenu = document.createElement("div");
  groupMenu.className = "group-menu";
  groups.forEach((group) => {
    const option = document.createElement("div");
    option.textContent = group;
    option.className = "group-menu-option";
    option.onclick = async (e) => {
      e.stopPropagation();
      const newGroup = product.group === group ? "" : group;
      groupDisplay.textContent = newGroup;
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
        groupDisplay.textContent = product.group;
      }
    };
    groupMenu.appendChild(option);
  });

  groupCell.onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll(".group-menu").forEach(m => {
      if (m !== groupMenu) m.style.display = "none";
    });
    groupMenu.style.left = "0px";
    groupMenu.style.top = "30px";
    groupMenu.style.display = groupMenu.style.display === "block" ? "none" : "block";
  };

  groupCell.appendChild(groupMenu);
  return groupCell;
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
      chartDiv.style.minHeight = "250px";

      const noData = document.createElement("div");
      noData.id = `no-data-${index}`;
      noData.className = "no-data-message";
      noData.textContent = "Veri oluşturma isteği gönderilmiştir.";
      noData.style = "display: none; text-align: center;";

      const disclaimer = document.createElement("div");
      disclaimer.className = "chart-disclaimer";
      disclaimer.textContent = "Grafik verileri, Yanyo (yaniyo.com) ve AFT sunucuları tarafından sağlanmaktadır.";

      // AKAKÇE BUTTON & CHART
      const akakceBtn = document.createElement("button");
      akakceBtn.className = "action-button akakce-fetch-btn";
      akakceBtn.style.marginTop = "15px";
      akakceBtn.style.width = "100%";
      akakceBtn.innerHTML = '<span class="material-icons" style="vertical-align: middle; font-size: 18px; margin-right: 8px;">insights</span> Akakçe Fiyat Geçmişini Getir';

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
                { name: 'Akakçe', data: formattedAkakceData, color: '#3b82f6' }
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

      akakceBtn.style.display = "none"; // Başlangıçta gizli başla (Flicker engelleme)
      content.append(chartDiv, noData, disclaimer, akakceBtn);
      cell.appendChild(content);
      accordion.appendChild(cell);
      productRow.insertAdjacentElement("afterend", accordion);

      if (data && Array.isArray(data) && data.length > 0) {
        // DB'den Akakçe verisi de var mı kontrol et
        getAllFromDB().then(dbProducts => {
          const stored = dbProducts.find(p => p.id === product.id);

          // FPS iyileştirmesi: Animasyonun başlaması için hafif gecikme
          setTimeout(() => {
            const hasAkakce = stored && stored.akakceHistory && stored.akakceHistory.length > 0;

            if (hasAkakce) {
              // Hem Amazon hem Akakçe verisi var, birleştirip çiz
              renderChart(`chart-${index}`, [
                { name: 'Amazon', data: data, color: '#FF9900' },
                { name: 'Akakçe', data: stored.akakceHistory, color: '#3b82f6' }
              ]);
            } else {
              // Sadece Amazon verisi var
              renderChart(`chart-${index}`, [
                { name: 'Amazon', data: data, color: '#FF9900' }
              ]);
              // Veri yoksa butonu göster
              akakceBtn.style.display = "flex";
            }
          }, 300);
        });
      }
      else {
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
