//popup > chart.js (bu açıklamayı silme)

const CONFIG = {
  TL_FORMAT: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  PERIODS: { "3ay": 3, "6ay": 6, "1yıl": 12 },
};

// Yeni fonksiyon: Yanyo'dan fiyat geçmişini çekme (Pop-up için)
async function fetchYanyoData(asin) {
  // Karartılmış (obfuscated) API anahtarları
  const PRICE_HISTORY_ARRAY_KEY = "dfwqsZwgh";
  const PRICE_KEY = "dfwqs";
  const DATE_KEY = "rohs";

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
      const arrayString = match[1];
      const obfuscatedArray = JSON.parse(arrayString);

      if (Array.isArray(obfuscatedArray)) {
        externalData = obfuscatedArray.map(item => {
          let date = item[DATE_KEY];
          const price = item[PRICE_KEY];

          if (price === null || date === null || typeof date !== 'string' || isNaN(parseFloat(price))) {
            return null;
          }

          // Tarih düzeltmeleri: N -> Z ve H -> T dönüşümleri
          if (date.endsWith('N')) {
            date = date.slice(0, -1) + 'Z';
          }
          if (date.charAt(10) === 'H') {
            date = date.slice(0, 10) + 'T' + date.slice(11);
          }

          const dateObj = new Date(date);

          if (isNaN(dateObj.getTime())) {
            console.warn("Invalid date found in Yanyo data, skipping:", item[DATE_KEY]);
            return null;
          }

          return {
            fiyat: parseFloat(price).toFixed(2).replace('.', ',') + " TL",
            tarih: dateObj.toISOString()
          };
        }).filter(item => item !== null);
      }
    }

    return externalData;

  } catch (err) {
    console.error("Yanyo data parsing/fetching failed:", err.message);
    return [];
  }
}

export async function fetchProductData(urun_id) {
  try {
    // 1. Yerel Veriyi Çek
    const res = await fetch(`https://amazon.aft.web.tr/GetPriceMysql.php?urun_id=${urun_id}`);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const localData = await res.json();

    // 2. Yanyo Verisini Çek
    const externalData = await fetchYanyoData(urun_id);

    let mergedData = Array.isArray(localData) ? localData : [];

    // 3. Verileri Birleştir
    if (Array.isArray(externalData) && externalData.length > 0) {
      const localDates = new Set(mergedData.map(d => new Date(d.tarih).toLocaleDateString()));

      const filteredExternal = externalData.filter(d => {
        const parsedPrice = parseFloat(d.fiyat.replace(' TL', '').replace(',', '.'));
        const dateStr = new Date(d.tarih).toLocaleDateString();

        return !isNaN(parsedPrice) && parsedPrice > 0 && !localDates.has(dateStr);
      });

      mergedData = [...mergedData, ...filteredExternal];
      mergedData.sort((a, b) => new Date(a.tarih) - new Date(b.tarih));
    }

    return mergedData;
  } catch (err) {
    console.error("AFT Grafik Verisi Alma Hatası:", err.message);
    throw new Error("Grafik verisi alınamadı");
  }
}

export function renderChart(canvasId, inputData) {
  if (!inputData) return;

  // Veri formatını normalize et: Her zaman [{ name: "...", data: [...], color: "..." }] formatında olsun.
  // Eski format (direkt array) gelirse "Amazon" varsayalım.
  let seriesRaw = [];
  if (Array.isArray(inputData) && inputData.length > 0 && inputData[0].name && Array.isArray(inputData[0].data)) {
    seriesRaw = inputData;
  } else if (Array.isArray(inputData)) {
    seriesRaw = [{ name: "Amazon", data: inputData, color: "#4575f7" }];
  } else {
    return;
  }

  const chartDiv = document.getElementById(canvasId);
  if (!chartDiv) return;
  const container = chartDiv.parentNode;

  const chart = echarts.getInstanceByDom(chartDiv) || echarts.init(chartDiv);

  const initialPeriod = "1yıl";

  // Helper: Tüm serileri verilen periyoda göre aggregate et
  const getAggregatedSeries = (periodKey) => {
    const months = CONFIG.PERIODS[periodKey];
    return seriesRaw.map(s => ({
      ...s,
      data: aggregateData(s.data, months)
    }));
  };

  const initialSeries = getAggregatedSeries(initialPeriod);
  chart.setOption(getChartOption(initialSeries, null), true); // true = merge yerine override (temiz kurulum)

  const headerId = 'priceHeader';
  let header = document.getElementById(headerId);

  // Butonları her seferinde yeniden oluştur (Closure sorununu çözmek için)
  // Eski header varsa içeriğini temizle
  if (header) {
    header.innerHTML = "";
  } else {
    header = document.createElement("div");
    header.id = headerId;
    container.insertBefore(header, container.firstChild);
  }

  const buttons = createHeader(header, initialPeriod); // createHeader artık container yerine header alıyor
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.id.replace("Btn", "");
      setActive(btn, buttons);

      const updatedSeries = getAggregatedSeries(key);
      chart.setOption(getChartOption(updatedSeries, null));
    });
  });

  window.addEventListener("resize", () => chart.resize());
}

function aggregateData(data, ay) {
  const result = [];
  const map = {};
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - ay, now.getDate());

  data.forEach(({ tarih, fiyat }) => {
    // 1. Tarih Kontrolü
    const d = new Date(tarih);
    if (isNaN(d) || d < start) return;

    // 2. Fiyat Parse (String ise temizle, Sayı ise olduğu gibi al)
    let parsedFiyat;
    if (typeof fiyat === 'string') {
      parsedFiyat = parseFloat(fiyat.replace(' TL', '').replace(',', '.'));
    } else {
      parsedFiyat = Number(fiyat);
    }

    if (isNaN(parsedFiyat)) return; // Fiyat geçersizse atla

    const key = d.toISOString().split("T")[0];
    if (!map[key]) map[key] = [];
    map[key].push(parsedFiyat);
  });

  for (const key in map) {
    const ort = Math.round(map[key].reduce((a, b) => a + b, 0) / map[key].length);
    result.push({ date: key, fiyat: ort });
  }

  return result.sort((a, b) => new Date(a.date) - new Date(b.date));
}

function calculateStats(data) {
  const prices = data.map((d) => d.fiyat).filter((p) => !isNaN(p));
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}

function createHeader(headerDiv, defaultKey) {
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";

  Object.keys(CONFIG.PERIODS).forEach((key) => {
    const btn = document.createElement("button");
    btn.id = `${key}Btn`;
    btn.textContent = key.replace("ay", " Ay").replace("yıl", " Yıl");
    btn.setAttribute("aria-label", `Son ${key} fiyatlarını göster`);
    if (key === defaultKey) btn.classList.add("active");
    buttonGroup.appendChild(btn);
  });

  headerDiv.appendChild(buttonGroup);
  return buttonGroup.querySelectorAll("button");
}

function setActive(activeBtn, buttons) {
  buttons.forEach((btn) => btn.classList.remove("active"));
  activeBtn.classList.add("active");
}

function getChartOption(seriesList, stats) {
  if (!seriesList || seriesList.length === 0) return {};

  let allPrices = [];
  seriesList.forEach(s => s.data.forEach(d => allPrices.push(d.fiyat)));
  const minY = Math.min(...allPrices);
  const maxY = Math.max(...allPrices);
  const padding = (maxY - minY) * 0.1;

  const finalSeries = seriesList.map(s => {
    const isAmazon = s.name.toLowerCase().includes("amazon") || s.name.toLowerCase().includes("yanyo");
    const color = isAmazon ? "#FF9900" : "#3498DB";

    return {
      name: s.name,
      color: color,
      data: s.data.map(d => [d.date, d.fiyat]),
      type: "line",
      smooth: true,
      showSymbol: false,
      lineStyle: {
        width: 4,
        color: color,
        shadowBlur: 15,
        shadowColor: color,
        shadowOffsetY: 5
      },
      areaStyle: {
        color: {
          type: "linear",
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: isAmazon ? "rgba(255, 153, 0, 0.3)" : "rgba(52, 152, 219, 0.3)" },
            { offset: 1, color: "rgba(0, 0, 0, 0)" }
          ]
        }
      },
      markPoint: isAmazon ? {
        symbol: "circle",
        symbolSize: 10,
        label: { show: false },
        itemStyle: { color: "#fff", borderColor: color, borderWidth: 2 },
        data: [{ type: "max", name: "Max" }, { type: "min", name: "Min" }]
      } : undefined
    };
  });

  return {
    grid: { left: "4%", right: "4%", top: 15, bottom: "10%", containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: 'rgba(8, 8, 12, 0.8)',
      borderColor: 'rgba(255, 255, 255, 0.1)',
      borderWidth: 1,
      textStyle: { color: '#fff', fontSize: 13, fontWeight: 500, fontFamily: 'Outfit' },
      axisPointer: { type: "line", lineStyle: { color: 'rgba(255,255,255,0.1)', width: 2 } },
      extraCssText: 'backdrop-filter: blur(12px); border-radius: 12px; box-shadow: 0 15px 35px rgba(0,0,0,0.6); padding: 12px;',
      valueFormatter: (value) => value ? `₺${value.toLocaleString("tr-TR", CONFIG.TL_FORMAT)}` : '-'
    },
    legend: {
      data: seriesList.map(s => s.name),
      top: 0,
      icon: 'circle',
      textStyle: { color: '#94a3b8', fontSize: 12, fontFamily: 'Outfit' }
    },
    xAxis: {
      type: "time",
      boundaryGap: false,
      axisLabel: {
        formatter: { year: '{yyyy}', month: '{MMM}', day: '{d} {MMM}' },
        color: '#64748b',
        fontSize: 10
      },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
      splitLine: { show: false }
    },
    yAxis: {
      type: "value",
      min: (v) => Math.floor(v.min - padding),
      max: (v) => Math.ceil(v.max + padding),
      axisLabel: {
        formatter: (val) => `₺${val.toLocaleString("tr-TR")}`,
        color: '#64748b',
        fontSize: 10
      },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.03)', type: 'dashed' } }
    },
    series: finalSeries,
  };
}

function formatDateTime(dateStr) {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

// Pop-up'ta bu fonksiyon kullanılmadığı için dışa aktarılmasına gerek yok
// window.getPriceHistory = getPriceHistory;