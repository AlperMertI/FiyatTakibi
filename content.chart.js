// content.chart.js

// Yeni fonksiyon: Yanyo'dan fiyat geçmişini çekme
async function fetchYanyoData(asin) {
  // Karartılmış (obfuscated) API anahtarları
  const PRICE_HISTORY_ARRAY_KEY = "dfwqsZwgh";
  const PRICE_KEY = "dfwqs"; // Fiyat değeri
  const DATE_KEY = "rohs"; // Tarih değeri

  // Kesin API Uç Noktası: Ürün ID'sine göre veri çeker
  const productApiUrl = `https://apiv2.yaniyo.com/api/product/id/${asin}`;

  try {
    const response = await fetch(productApiUrl, { credentials: 'omit' });
    if (!response.ok) {
      console.error("Yanyo Product ID API HTTP error:", response.status);
      return [];
    }

    const rawText = await response.text();

    // Regex kullanarak fiyat geçmişi dizisini ({... "dfwqsZwgh": [...] ...}) ham metinden çekiyoruz.
    const regex = new RegExp(`"${PRICE_HISTORY_ARRAY_KEY}"\\s*:\\s*(\\[[\\s\\S]*?\\])`, 'i');
    const match = rawText.match(regex);

    let externalData = [];

    if (match && match[1]) {
      // Çekilen dizi metnini JSON olarak parse et
      const arrayString = match[1];
      const obfuscatedArray = JSON.parse(arrayString);

      if (Array.isArray(obfuscatedArray)) {
        externalData = obfuscatedArray.map(item => {
          let date = item[DATE_KEY];
          const price = item[PRICE_KEY];

          if (price === null || date === null || typeof date !== 'string' || isNaN(parseFloat(price))) {
            return null;
          }

          // Standart dışı 'N' karakterini 'Z' ile değiştir.
          if (date.endsWith('N')) {
            date = date.slice(0, -1) + 'Z';
          }

          // YYYY-MM-DDH...' formatındaki 'H' karakterini 'T' ile değiştir.
          if (date.charAt(10) === 'H') {
            date = date.slice(0, 10) + 'T' + date.slice(11);
          }

          const dateObj = new Date(date);

          // Hata kontrolü: Eğer tarih nesnesi geçersizse (Invalid time value), bu veriyi atla.
          if (isNaN(dateObj.getTime())) {
            console.warn("Invalid date found in Yanyo data, skipping:", item[DATE_KEY]);
            return null;
          }

          return {
            // Kendi formatımıza dönüştür: "100,00 TL"
            fiyat: parseFloat(price).toFixed(2).replace('.', ',') + " TL",
            // Hata ayıklanmış tarihi ISO formatında kaydet
            tarih: dateObj.toISOString()
          };
        }).filter(item => item !== null);
      }
    }

    return externalData;

  } catch (error) {
    console.error("Yanyo data parsing/fetching failed:", error);
    return [];
  }
}


async function getPriceHistory(asin) {
  try {
    const res = await fetch(`https://amazon.aft.web.tr/GetPriceMysql.php?urun_id=${asin}`);
    const localData = await res.json();

    const nowPrice = window.getLivePrice?.();
    const parsedNow = parseFloat(nowPrice?.replace(/\./g, "").replace(",", "."));

    if (Number.isFinite(parsedNow) && parsedNow > 0) {
      await fetch("https://amazon.aft.web.tr/UpdatePriceUser.php", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ urun_id: asin, fiyat: nowPrice }),
      });
    }

    const res2 = await fetch(`https://amazon.aft.web.tr/GetPriceMysql.php?urun_id=${asin}`);
    const localDataUpdated = await res2.json();

    // Harici veriyi çekme
    let externalData = await fetchYanyoData(asin);

    // --- AKAKÇE VERİSİ ÇEKME (PARALEL) ---
    let akakceData = [];
    let akakceCurrentPrice = null;
    try {
      const productTitleEl = document.getElementById("productTitle");
      const productTitle = productTitleEl ? productTitleEl.textContent.trim() : "";
      if (productTitle) {
        // 1. Önce Local DB'den kontrol et (Gereksiz Scrape Önleme)
        // `asin` değişkeni üst scope'tan geliyor (getPriceHistory argümanı)
        const dbResponse = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: "GET_PRODUCT_DATA", id: asin }, r => resolve(r));
        });

        const todayStr = new Date().toISOString().split('T')[0];
        let useStoredData = false;

        if (dbResponse && dbResponse.success && dbResponse.product) {
          const p = dbResponse.product;
          if (p.akakceHistory && p.akakceHistory.length > 0) {
            const lastEntry = p.akakceHistory[p.akakceHistory.length - 1];
            // Tarih formatı YYYY-MM-DD veya ISO olabilir, kontrol et.
            const lastDate = (lastEntry.tarih || lastEntry.date || "").split('T')[0];

            if (lastDate === todayStr) {
              console.log("Bugüne ait Akakçe verisi DB'de bulundu, scrape atlanıyor.");
              akakceData = p.akakceHistory;
              useStoredData = true;
              // currentPrice'ı son entry'den alabiliriz
              akakceCurrentPrice = lastEntry.fiyat;
            }
          }
        }

        if (!useStoredData) {
          // Background'a sor (Scrape Trigger)
          const akakceRes = await new Promise(resolve => {
            // Kullanıcı sayfadayken öncelikli (priority: true)
            chrome.runtime.sendMessage({ action: "SEARCH_AND_SCRAPE_AKAKCE_HISTORY", productName: productTitle, priority: true }, response => {
              resolve(response);
            });
          });

          if (akakceRes && (akakceRes.success || akakceRes.partial)) {
            // ... (rest of logic unchanged)
            if (akakceRes.data && akakceRes.data.length > 0) {
              akakceData = akakceRes.data;
            } else if (akakceRes.currentPrice) {
              // ...
            }
            akakceCurrentPrice = akakceRes.currentPrice;
          }
        }
      }
    } catch (err) {
      console.error("Akakçe veri hatası:", err);
    }

    let mergedData = Array.isArray(localDataUpdated) ? localDataUpdated : [];

    // Veri Birleştirme Mantığı
    if (Array.isArray(externalData) && externalData.length > 0) {
      const localDates = new Set(mergedData.map(d => new Date(d.tarih).toLocaleDateString()));

      externalData = externalData.filter(d => {
        const parsedPrice = parseFloat(d.fiyat.replace(' TL', '').replace(',', '.'));
        const dateStr = new Date(d.tarih).toLocaleDateString();

        return !isNaN(parsedPrice) && parsedPrice > 0 && !localDates.has(dateStr);
      });

      mergedData = [...mergedData, ...externalData];
      mergedData.sort((a, b) => new Date(a.tarih) - new Date(b.tarih));
    }

    if ((!Array.isArray(mergedData) || mergedData.length < 2) && akakceData.length < 2) return;

    // Mesaj ve sınıflandırma (mevcut mantık)
    const { mesaj, sınıf } = getPriceMessage(mergedData, nowPrice);

    // Tarih Birleştirme
    const allDates = new Set();
    mergedData.forEach(d => allDates.add(new Date(d.tarih).toISOString().split('T')[0]));
    akakceData.forEach(d => allDates.add(new Date(d.tarih).toISOString().split('T')[0]));

    const sortedDates = Array.from(allDates).sort();
    const finalLabels = sortedDates.map(d => new Date(d).toLocaleDateString("tr-TR"));

    // Veri noktalarını eşleştirme
    // mergedData (Amazon)
    const amazonMap = new Map();
    mergedData.forEach(d => {
      amazonMap.set(new Date(d.tarih).toISOString().split('T')[0], parseFloat(d.fiyat.replace(' TL', '').replace(',', '.')));
    });

    const amazonPoints = sortedDates.map(dateStr => amazonMap.get(dateStr) || null);

    // akakceData
    const akakceMap = new Map();
    akakceData.forEach(d => {
      akakceMap.set(new Date(d.tarih).toISOString().split('T')[0], d.fiyat);
    });
    const akakcePoints = sortedDates.map(dateStr => akakceMap.get(dateStr) || null);

    const rawEntries = mergedData;

    insertBox(sınıf, mesaj, finalLabels, amazonPoints, rawEntries, akakcePoints, akakceCurrentPrice);
  } catch (e) {
    console.error("Fiyat geçmişi hatası:", e);
  }
}

function getPriceMessage(data, nowPrice) {
  const V = { ...data.at(-1), tarih: new Date(data.at(-1).tarih) };
  const fiyatlar = data.map((d) => ({ tarih: new Date(d.tarih), fiyat: parseFloat(d.fiyat.replace(' TL', '').replace(',', '.')) })).filter((d) => Number.isFinite(d.fiyat));

  const N = parseFloat(nowPrice?.replace(/\./g, "").replace(",", "."));
  const B = fiyatlar.at(-2);
  const L = fiyatlar.reduce((a, b) => (b.fiyat < a.fiyat ? b : a));
  const maxFiyat = Math.max(...fiyatlar.map((d) => d.fiyat));
  const T = Math.ceil((V.tarih - fiyatlar[0].tarih) / 864e5);
  const enDusukTekrar = fiyatlar.filter((d) => d.fiyat === L.fiyat);

  const sameN = fiyatlar.filter((d) => d.fiyat === N && d.tarih.getTime() !== V.tarih.getTime());
  const S = sameN.length > 0 ? sameN.sort((a, b) => Math.abs(V.tarih - a.tarih) - Math.abs(V.tarih - b.tarih))[0] : null;

  const Y =
    fiyatlar
      .filter((d) => d.tarih.getTime() !== V.tarih.getTime())
      .map((d) => ({ ...d, diff: Math.abs(d.fiyat - N) }))
      .sort((a, b) => a.diff - b.diff)[0] || null;

  const yüzde = Math.round(Math.abs(((N - B.fiyat) / B.fiyat) * 1000)) / 10;
  const akış = `${TL(B.fiyat)} → ${TL(N)}`;

  let mesaj = "",
    sınıf = "";

  if (!Number.isFinite(N) || N <= 0) {
    mesaj = `Ürünün son fiyatı ${TL(V.fiyat)} idi.<br><br>${format(L.tarih)} tarihinde ${TL(L.fiyat)} fiyattı.`;
    sınıf = "bilgi";
  } else if (N < B.fiyat) {
    mesaj = `📉 (%${yüzde} indirim) ${akış}`;

    if (N === L.fiyat) {
      mesaj += `<br><br>Son ${T} günün En Düşük fiyatı.`;
      if (enDusukTekrar.length > 1) {
        mesaj += `<br><br>${format(L.tarih)} tarihinden sonra En Uygun Fiyat.`;
      }
    } else if (S) {
      mesaj += `<br><br>${format(S.tarih)} tarihinden sonra En Uygun Fiyat.`;
    } else if (Y) {
      mesaj += `<br><br>${format(Y.tarih)} tarihinden sonra En Uygun Fiyat.`;
    }

    sınıf = "indirim";
  } else if (N > B.fiyat) {
    mesaj = `📈 (%${yüzde} zam) ${akış}`;
    mesaj += `<br><br>${format(L.tarih)} tarihinde En düşük ${TL(L.fiyat)} idi.`;
    if (N === maxFiyat) {
      mesaj += `<br><br>Son ${T} günün En yüksek fiyatı.`;
    }
    sınıf = "zam";
  } else {
    mesaj = `Ürünün son fiyatı ${TL(V.fiyat)} idi.<br><br>${format(L.tarih)} tarihinde ${TL(L.fiyat)} fiyattı.`;
    sınıf = "bilgi";
  }

  return { mesaj, sınıf };
}

function TL(val) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? `${n.toLocaleString("tr-TR")} TL` : "";
}

function format(date) {
  const d = new Date(date);
  return d.toLocaleDateString("tr-TR");
}

function insertBox(cls, html, labels, dataPoints, rawEntries, akakcePoints, akakceCurrentPrice) {
  document.querySelector(".price-history-box")?.remove();

  const box = document.createElement("div");
  box.className = `price-history-box ${cls}`;
  box.innerHTML = html;
  box.style.position = "relative";

  const shareBtn = document.createElement("button");
  shareBtn.textContent = "Paylaş";
  shareBtn.style.cssText = `
    display: inline-block;
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
    z-index: 10;
    background-color: #ff7300ff;
    border: 1px solid #0059ffff;
    border-radius: 4px;
    color: #333;
  `;

  shareBtn.onclick = async () => {
    const tempDiv = Object.assign(document.createElement("div"), {
      style: { position: "absolute", left: "-9999px" },
    });
    document.body.appendChild(tempDiv);

    const boxClone = box.cloneNode(true);
    boxClone.querySelector("button")?.remove();
    tempDiv.appendChild(boxClone);

    const idMatch = window.location.pathname.match(/\/(?:dp|gp\/product)\/([^\/]+)/);
    const id = idMatch?.[1];
    const url = `https://www.amazon.com.tr/dp/${id}?th=1&psc=1`;

    const urlPara = document.createElement("p");
    urlPara.textContent = url;
    urlPara.style.cssText = "margin-bottom:12px;font-weight:bold;color:#333;";
    tempDiv.appendChild(urlPara);

    try {
      await navigator.clipboard.writeText(tempDiv.innerText);
      window.toast("Ürün bilgisi kopyalandı.", "success");
    } catch (err) {
      window.toast("Kopyalama başarısız.", "error");
    }

    tempDiv.remove();
  };

  box.appendChild(shareBtn);

  const target = document.querySelector("#followButton");
  if (target) target.insertAdjacentElement("afterend", box);
  const chartContainer = document.querySelector("#chartDiv")?.parentElement;
  if (chartContainer) chartContainer.remove();

  insertChartAfterPPD(labels, dataPoints, rawEntries, akakcePoints, akakceCurrentPrice);
}

//grafik ekleme
function insertChartAfterPPD(labels, dataPoints, rawEntries, akakcePoints = [], akakceCurrentPrice = null) {
  const ppdEndDiv = document.querySelector("#ppd") || document.querySelector("#hover-zoom-end");
  if (!ppdEndDiv) return;

  const hasAmazon = Array.isArray(dataPoints) && dataPoints.length > 0;
  // Daha sıkı kontrol: null olmayan en az 1 değer varsa
  const hasAkakce = Array.isArray(akakcePoints) && akakcePoints.some(x => x !== null && x !== undefined && x > 0);

  if (!hasAmazon && !hasAkakce) {
    const noDataDiv = document.createElement("div");
    noDataDiv.id = "chartDiv";
    noDataDiv.className = "no-data";
    noDataDiv.textContent = "Grafik verisi bulunamadı.";
    ppdEndDiv.insertAdjacentElement("afterend", noDataDiv);
    return;
  }

  // Eğer Akakçe current price varsa, sayfada göster
  if (akakceCurrentPrice) {
    // Fiyat gösterim alanı oluştur veya ekle
    const priceBox = document.createElement("div");
    priceBox.style.cssText = "padding: 10px; background: #f0f8ff; border: 1px solid #2196F3; margin-bottom: 5px; border-radius: 4px; font-weight: bold; color: #333;";
    priceBox.innerHTML = `Akakçe Güncel Fiyat: <span style="color:#e91e63; font-size:1.1em;">${akakceCurrentPrice.toLocaleString('tr-TR')} TL</span>`;
  }

  const chartDiv = document.createElement("div");
  chartDiv.id = "chartDiv";
  chartDiv.className = "chart-area";

  const container = document.createElement("div");
  container.id = "priceChartContainer";
  container.className = "chart-container";

  if (akakceCurrentPrice) {
    const infoDiv = document.createElement("div");
    infoDiv.style.cssText = "margin-bottom:5px; font-size:13px; color:#555;";
    infoDiv.innerHTML = `<b>Akakçe Fiyatı:</b> ${akakceCurrentPrice.toLocaleString('tr-TR')} TL`;
    container.appendChild(infoDiv);
  }

  container.appendChild(chartDiv);

  const disclaimer = document.createElement("div");
  disclaimer.className = "chart-disclaimer"; // CSS'i styles.css'e eklenecek
  disclaimer.textContent = "Grafik verileri, Yanyo (yaniyo.com), AFT ve Akakçe tarafından sağlanmaktadır.";
  container.appendChild(disclaimer); // Bilgilendirmeyi container'a ekle

  ppdEndDiv.insertAdjacentElement("afterend", container);

  const chart = echarts.init(chartDiv);

  // Min/Max hesapla (her iki seri için)
  const allValues = [];
  if (hasAmazon) dataPoints.forEach(v => { if (v) allValues.push(v); });
  if (hasAkakce) akakcePoints.forEach(v => { if (v) allValues.push(v); });

  const minY = allValues.length ? Math.min(...allValues) - 10 : 0;
  const maxY = allValues.length ? Math.max(...allValues) + 10 : 100;

  const seriesList = [];

  // Amazon Serisi
  if (hasAmazon) {
    seriesList.push({
      name: 'Amazon/Yanyo',
      data: dataPoints,
      type: "line",
      smooth: true,
      connectNulls: true, // Boşlukları birleştir
      lineStyle: { color: "#4575f7", width: 3 },
      itemStyle: { color: "#4575f7" },
      showSymbol: false,
      areaStyle: {
        color: {
          type: "linear",
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: "rgba(69, 117, 247, 0.3)" },
            { offset: 1, color: "rgba(69, 117, 247, 0.05)" },
          ],
        },
      },
      markPoint: {
        symbol: "pin",
        symbolSize: 30, // Biraz büyüttüm
        data: [
          { type: "max", itemStyle: { color: "#d32f2f" }, name: "Max" },
          { type: "min", itemStyle: { color: "#1976d2" }, name: "Min" },
        ],
      },
    });
  }

  // Akakçe Serisi
  if (hasAkakce) {
    seriesList.push({
      name: 'Akakçe',
      data: akakcePoints,
      type: "line",
      smooth: true,
      connectNulls: true,
      lineStyle: { color: "#e91e63", width: 3, type: 'dashed' }, // Ayırt edici olması için kesik çizgi
      itemStyle: { color: "#e91e63" },
      showSymbol: false,
      // Akakçe için alan boyamaya gerek yok veya farklı renk
    });
  }

  // YENİ LEGEND MANTIĞI: seriesList'ten isimleri otomatik al
  const legendData = seriesList.map(s => s.name);

  chart.setOption({
    legend: {
      data: legendData,
      bottom: 0
    },
    grid: { left: "2%", right: "2%", bottom: "10%", top: "5%", containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      formatter: (params) => {
        // params bir dizidir (her seri için bir obje)
        if (!params || params.length === 0) return "";

        const dateIndex = params[0].dataIndex;
        const date = labels[dateIndex];

        let html = `<div style="font-weight:bold; border-bottom:1px solid #ddd; margin-bottom:5px;">${date}</div>`;

        params.forEach(p => {
          const val = p.value;
          if (val !== null && val !== undefined) {
            const color = p.color;
            const name = p.seriesName;
            html += `<div style="color:${color}">● ${name}: <b>${val.toFixed(2)} TL</b></div>`;
          }
        });

        // Çakışma uyarısı
        if (params.length > 1) {
          const v1 = params[0].value;
          const v2 = params[1].value;
          if (v1 === v2 && v1 !== null) {
            html += `<div style="color:#FF9800; font-size:11px; margin-top:5px;">⚠️ Fiyatlar aynı</div>`;
          }
        }

        return html;
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      boundaryGap: false,
      axisLabel: { interval: 'auto' }, // Otomatik aralık
    },
    yAxis: {
      type: "value",
      min: minY > 0 ? minY : 0,
      max: maxY,
      axisLabel: { formatter: (v) => `₺${Math.round(v)}` },
      splitLine: { show: true, lineStyle: { type: 'dotted' } }
    },
    series: seriesList,
  });
}

window.getPriceHistory = getPriceHistory;