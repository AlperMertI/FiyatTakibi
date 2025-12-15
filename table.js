// popup > table.js
import { getAllFromSync, saveToSync, getAllFromDB, saveToDB, removeFromDB } from "./storage.js";
import { fetchProductData, renderChart } from "./chart.js";
import { updateBadgeCount } from "./update.js";
import { showToast } from "./notifications.js";
import { parsePrice, timeAgo } from "./price-utils.js"; // timeAgo buradan geliyor

let expandedRowIndex = null;

export async function renderProductList(products, productList, updateBadgeCount) {
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
    productList.appendChild(createProductRow(product, index, toggleAccordion, updateBadgeCount, productList));
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

export function createProductRow(product, index, toggleAccordion, updateBadgeCount, productList) {

  const productRow = document.createElement("div");
  productRow.className = "product-row";
  productRow.dataset.id = product.id;

  // Group Cell
  const groupCell = document.createElement("div");
  groupCell.className = "cell-group";
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

        const allDataFromDB = await getAllFromDB();
        const allDataFromSync = await getAllFromSync();
        const dbMap = new Map(allDataFromDB.map(item => [item.id, item]));
        const mergedData = allDataFromSync.map(p => ({ ...p, ...(dbMap.get(p.id) || {}) }));
        const sortedData = mergedData.sort((a, b) => (a.no || Infinity) - (b.no || Infinity));

        renderProductList(sortedData, productList, updateBadgeCount);

      } catch (e) {
        showToast("Hata oluştu.", "error");
        groupCell.textContent = product.group;
      }
    };
    groupMenu.appendChild(option);
  });
  groupCell.onclick = () => {
    const rect = groupCell.getBoundingClientRect();
    groupMenu.style.left = `${rect.left + window.scrollX + 32}px`;
    groupMenu.style.top = `${rect.top + window.scrollY - 30}px`;
    groupMenu.style.display = "block";
  };
  groupCell.appendChild(groupMenu);
  productRow.appendChild(groupCell);

  // Number Cell
  const noCell = document.createElement("div");
  noCell.className = "cell-number";
  noCell.textContent = index + 1; // Sadece listedeki sırasını gösterir
  productRow.appendChild(noCell);

  // Image Cell
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

  // Name Cell
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

  if (product.status === "Stokta Yok") {
    statusCell.textContent = "Stok Yok";
  } else {
    statusCell.textContent = product.status || "";
  }

  const statusTitles = {
    "➕": "Ürün stoğa girdi",
    "⬆️": "Zam geldi",
    "⬇️": "İndirim geldi",
    "‼️": "Hata",
    "Stokta Yok": "Stokta Yok",
    "🟰": "Fiyat değişmedi",
    "✅": "Kontrol edildi"
  };
  statusCell.title = statusTitles[statusCell.textContent] || "";

  const chartIcon = document.createElement("span");
  chartIcon.className = "material-icons chart-chevron-icon";
  chartIcon.textContent = "expand_more";
  statusCell.appendChild(chartIcon);

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

      content.append(chartDiv, noData, disclaimer);
      cell.appendChild(content);
      accordion.appendChild(cell);
      productRow.insertAdjacentElement("afterend", accordion);

      if (data && Array.isArray(data) && data.length > 0) {
        renderChart(`chart-${index}`, data);
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