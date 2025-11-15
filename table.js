// popup > table.js
import { getAllFromSync, saveToSync, removeFromSync, getAllFromDB, saveToDB, removeFromDB } from "./storage.js";
import { fetchProductData, renderChart } from "./chart.js";
import { updateBadgeCount } from "./update.js";
import { showToast } from "./notifications.js";
import { saveFromChart } from "./sendUrl.js";
import { parsePrice } from "./price-utils.js";

let expandedRowIndex = null;

// sortByOrder fonksiyonunu doğrudan buraya alalım
function sortByOrder(products, order) {
  const orderMap = new Map(order.map((o) => [o.id, o.no]));
  return products.sort((a, b) => {
    const aNo = orderMap.get(a.id) || Infinity;
    const bNo = orderMap.get(b.id) || Infinity;
    return aNo - bNo;
  });
}

/**
 * Ürün listesini render eder.
 * @param {Array} products - GÖRÜNTÜLENECEK ÜRÜN BİLGİLERİ (pic, no, date vb. içeren tam DB verisi)
 * @param {HTMLElement} productList - product-tbody elementi
 * @param {Function} updateBadgeCount - Badge güncelleme fonksiyonu
 */
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

/**
 * Tek bir ürün satırı (div) oluşturur.
 * @param {Object} product - pic, no, date, name vb. içeren tam DB verisi
 */
export function createProductRow(product, index, toggleAccordion, updateBadgeCount, productList) {

  const productRow = document.createElement("div");
  productRow.className = "product-row";
  productRow.dataset.id = product.id;

  // Grup hücresi
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
      // 1. UI'ı anında güncelle
      const newGroup = product.group === group ? "" : group;
      groupCell.textContent = newGroup || "";
      groupMenu.style.display = "none";

      try {
        // 2. Sync storage'ı güncelle (pic olmayan veri)
        const productsFromSync = await getAllFromSync();
        const i = productsFromSync.findIndex((p) => p.id === product.id);
        if (i >= 0) {
          productsFromSync[i].group = newGroup;
          await saveToSync(productsFromSync);
        }

        // 3. DB'yi güncelle (pic olan veri)
        await saveToDB([{ id: product.id, group: newGroup }]);

        // 4. DB'den ve Sync'den son veriyi çek, birleştir, sırala ve render et
        const allDataFromDB = await getAllFromDB();
        const allDataFromSync = await getAllFromSync();
        const dbMap = new Map(allDataFromDB.map(item => [item.id, item]));
        const mergedData = allDataFromSync.map(p => ({ ...p, ...(dbMap.get(p.id) || {}) }));
        const sortedData = mergedData.sort((a, b) => (a.no || Infinity) - (b.no || Infinity));

        renderProductList(sortedData, productList, updateBadgeCount);

      } catch (e) {
        showToast("Hata oluştu. Lütfen tekrar deneyin.", "error");
        groupCell.textContent = product.group; // Hata olursa eski gruba dön
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

  // Sıra numarası
  const noCell = document.createElement("div");
  noCell.className = "cell-number";
  noCell.textContent = product.no || index + 1;
  productRow.appendChild(noCell);
  noCell.addEventListener("mouseenter", () => {
    noCell.title = product.date || "";
  });

  const imageCell = document.createElement("div");
  imageCell.className = "cell-image";
  const previewImg = document.createElement("img");
  previewImg.className = "preview-img";
  console.log(`AFT (DEBUG) createProductRow (ID: ${product.id}): Satır oluşturuluyor. picUrl: ${product.picUrl}, pic (base64): ${product.pic ? 'var' : 'yok'}`);

  if (product.picUrl) {
    previewImg.src = product.picUrl; // 1. Öncelik: Normal resim URL'si
  } else {
    previewImg.src = ""; // picUrl yoksa
    previewImg.classList.add("no-image");
  }

  imageCell.appendChild(previewImg);
  productRow.appendChild(imageCell); // Görsel hücresini satıra ekle

  const nameCell = document.createElement("div");
  nameCell.className = "cell-name";

  const link = document.createElement("a");
  link.href = product.url;
  link.target = "_blank";
  link.textContent = product.name;
  link.title = product.name;

  nameCell.appendChild(link);
  productRow.appendChild(nameCell);

  // Eski fiyat
  const oldPriceCell = document.createElement("div");
  oldPriceCell.className = "cell-price-old";
  oldPriceCell.textContent = product.oldPrice ? product.oldPrice.replace("TL", " TL") : "";
  oldPriceCell.title = product.date ? `Eklendi: ${product.date}` : "Ekleme tarihi bilinmiyor";
  productRow.appendChild(oldPriceCell);

  // Yüzdesel Değişim Hücresi ---
  const percentCell = document.createElement("div");
  percentCell.className = "cell-percent";

  const oldP = parsePrice(product.oldPrice);
  const newP = parsePrice(product.newPrice); // Bu null olabilir

  // Fiyatlar geçerliyse ve değişmişse hesapla
  if (!isNaN(oldP) && !isNaN(newP) && oldP > 0 && newP > 0) {
    if (oldP !== newP) {
      const percentChange = ((newP - oldP) / oldP) * 100;
      percentCell.textContent = `${percentChange > 0 ? '+' : ''}${percentChange.toFixed(0)}%`;
      // CSS için sınıf ekle
      percentCell.classList.add(percentChange > 0 ? "positive" : "negative");
    } else {
      percentCell.textContent = "0%";
    }
  }
  // Yeni fiyat henüz yoksa veya stokta yoksa
  else if (!isNaN(oldP) && (product.status === null || product.status === "🟰" || product.status === "✅")) {
    percentCell.textContent = "0%";
  }
  else {
    percentCell.textContent = "-";
  }
  productRow.appendChild(percentCell);

  // Yeni fiyat
  const newPriceCell = document.createElement("div");
  newPriceCell.className = "cell-price-new";
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

    newPriceCell.style.color = !oldP_ ? "#3498DB" : newP_ < oldP_ ? "#2ECC71" : newP_ > oldP_ ? "#E74C3C" : "";
    newPriceCell.textContent = newPrice.replace("TL", " TL");
  }
  productRow.appendChild(newPriceCell);

  // Durum
  const statusCell = document.createElement("div");
  statusCell.className = "cell-status";
  // Stokta Yok durumu için "‼️" yerine metin göster
  if (product.status === "Stokta Yok") {
    statusCell.textContent = "Stok Yok";
  } else {
    statusCell.textContent = product.status || "";
  }

  const statusTitles = {
    "➕": "Ürün stoğa girdi (Onaylamak için tıkla)",
    "⬆️": "Zam geldi (Onaylamak için tıkla)",
    "⬇️": "İndirim geldi (Onaylamak için tıkla)",
    "‼️": "Kontrol hatası (Sayfa bulunamadı veya yapı değişti)",
    "Stokta Yok": "Ürün stokta bulunmuyor",
    "🟰": "Fiyat değişmedi",
    "✅": "Fiyat başarıyla kontrol edildi"
  };
  statusCell.title = statusTitles[statusCell.textContent] || "";

  // Grafiğin açılabilir olduğunu gösteren ikon
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

        showToast("Ürün fiyatı güncellendi.", "success");
      } catch (error) {
        showToast("Durum güncellerken hata oluştu.", "error");
      }
    }
  };
  productRow.appendChild(statusCell);

  // Silme butonu
  const deleteCell = document.createElement("div");
  deleteCell.className = "cell-actions";
  const deleteButton = document.createElement("button");
  deleteButton.className = "delete-btn";
  deleteButton.title = "Ürünü Sil";
  deleteButton.innerHTML = "<span>&times;</span>";
  deleteButton.onclick = () => removeProduct(product.id, productList, updateBadgeCount);
  deleteCell.appendChild(deleteButton);
  productRow.appendChild(deleteCell);

  // Tüm satıra tıklama olayı
  productRow.addEventListener("click", (e) => {
    // Tıklanan yerin buton olup olmadığını kontrol et
    // (Butonlara tıklandığında grafik açılmasın)
    if (e.target.closest(".delete-btn, .cell-group, .cell-name a, .cell-status")) {
      // Eğer durum hücresine tıklandıysa (ikon dahil) veya linke/gruba tıklandıysa
      if (e.target.closest(".cell-status") && !e.target.closest(".cell-status span.material-icons")) {
        // Sadece ikon değil, hücrenin kendi tıklama olayı (onaylama) ise devam et
      } else if (e.target.closest(".cell-name a, .cell-group, .delete-btn")) {
        // Link, grup veya sil butonu ise bir şey yapma (varsayılan davranışı yapsın)
        return;
      }
    }
    // Satırın geri kalanına (veya durum ikonuna) tıklanırsa grafiği aç
    toggleAccordion(index, product, productList);
  });
  return productRow;
}

export function toggleAccordion(index, product, productList) {
  const existingAccordion = document.querySelector(".accordion-row");
  const chartIcon = productList.querySelector(`div[data-id="${product.id}"] .chart-chevron-icon`);

  document.querySelectorAll(".chart-chevron-icon").forEach(icon => icon.textContent = "expand_more");

  // 1. Akordiyon Kapanma/Açılma Mantığı
  if (existingAccordion) {
    existingAccordion.remove();
    if (expandedRowIndex === index) {
      // Zaten açıksa kapat ve ikonun kapalı olduğundan emin ol
      if (chartIcon) chartIcon.textContent = "expand_more";
      expandedRowIndex = null;
      return; // <-- KRİTİK: Kapatma işlemi bitti, fonksiyondan çık
    }
  }

  fetchProductData(product.id)
    .then((data) => {
      const productRow = productList.querySelector(`div[data-id="${product.id}"]`);
      if (!productRow) return;

      // 1. DOM Elementlerini Oluştur
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
      disclaimer.textContent = "Grafik verileri, Yanyo (yaniyo.com) ve AFT sunucuları tarafından sağlanmaktadır. Veri doğruluğu veya sürekliliği garanti edilmez.";

      // 2. Elementleri birleştir ve DOM'a ekle (KRİTİK ADIM)
      content.append(chartDiv, noData, disclaimer);
      cell.appendChild(content);
      accordion.appendChild(cell);
      productRow.insertAdjacentElement("afterend", accordion); // <-- ÖNCE EKLİYORUZ

      // 3. Veri kontrolü ve grafik çizimi (DOM'a eklendikten sonra)
      if (data && Array.isArray(data) && data.length > 0) {
        renderChart(`chart-${index}`, data); // <-- ARTIK GÜVENLİ
      } else {
        noData.style.display = "block";
        noData.textContent = "Grafik verisi bulunamadı. Veri toplama isteği gönderilmiştir.";
      }

      // 4. İkonu ve durumu güncelle
      if (chartIcon) {
        chartIcon.textContent = "expand_less";
      }

      expandedRowIndex = index;
    })
    .catch((error) => {
      console.error("Grafik verisi alınırken hata:", error);
      showToast("Veri alınırken hata oluştu.", "error");

      // 5. Hata durumunda ikonu kapat
      if (chartIcon) {
        chartIcon.textContent = "expand_more";
      }
      // Hata oluştuğu için akordiyonu kapat
      if (document.querySelector(".accordion-row")) {
        document.querySelector(".accordion-row").remove();
      }
      expandedRowIndex = null;
    });
}


export async function removeProduct(id, productList, updateBadgeCount) {
  try {
    // 1. Ürünü *hem* Sync'den *hem* DB'den kaldır.
    // storage.js'deki bu fonksiyon ikisini de yapıyor.
    await removeFromSync(id);

    // 2. Kalan verileri al (artık ikisi de eksik olmalı)
    const productsFromSync = await getAllFromSync();
    let productsFromDB = await getAllFromDB();

    // 3. DB'deki kalan ürünleri yeniden numaralandır
    // (Sıralamayı korumak için önemlidir)
    productsFromDB.sort((a, b) => (a.no || Infinity) - (b.no || Infinity));
    const reorderedDBItems = productsFromDB.map((o, index) => ({ ...o, no: index + 1 }));

    // 4. Yeniden numaralanmış listeyi DB'ye kaydet
    // (Bu, 'no' alanlarını günceller)
    await saveToDB(reorderedDBItems);

    // 5. Kalan Sync ve DB verisini birleştir (Arayüzü çizmek için)
    const dbDataMap = new Map(reorderedDBItems.map(item => [item.id, item]));
    const mergedData = productsFromSync.map(product => ({
      ...product,
      ...(dbDataMap.get(product.id) || {})
    }));

    // 6. Sıralı, birleşmiş veriyle listeyi yeniden çiz
    const sortedData = mergedData.sort((a, b) => (a.no || Infinity) - (b.no || Infinity));
    renderProductList(sortedData, productList, updateBadgeCount);

    showToast("Ürün listeden silindi.", "success");

  } catch (error) {
    console.error("Ürün silinirken hata:", error);
    showToast("Ürünü silerken hata oluştu.", "error");
  }
}