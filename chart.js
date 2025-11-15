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

export function renderChart(canvasId, data) {
  if (!Array.isArray(data) || data.length === 0) return;

  const container = document.getElementById(canvasId)?.parentNode;
  if (!container) return;

  const chartDiv = document.createElement("div");
  chartDiv.id = `${canvasId}-echart`;
  chartDiv.style.height = "200px";
  chartDiv.style.width = "100%";
  container.appendChild(chartDiv);

  const chart = echarts.init(chartDiv);

  const initialPeriod = "1yıl";
  const initialAgg = aggregateData(data, CONFIG.PERIODS[initialPeriod]);
  const stats = calculateStats(initialAgg);

  chart.setOption(getChartOption(initialAgg, stats));

  const header = document.querySelector(`#${canvasId}`).previousElementSibling; // Mevcut yerleşimde butonlar tablonun altında olduğu için

  // Eğer butonlar zaten varsa, tekrar eklemeyi önle
  if (!header || header.id !== 'priceHeader') {
    const buttons = createHeader(container, initialPeriod);
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.id.replace("Btn", "");
        setActive(btn, buttons);
        const agg = aggregateData(data, CONFIG.PERIODS[key]);
        const stats = calculateStats(agg);
        chart.setOption(getChartOption(agg, stats));
      });
    });
  }

  window.addEventListener("resize", () => chart.resize());
}

function aggregateData(data, ay) {
  const result = [];
  const map = {};
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - ay, now.getDate());

  data.forEach(({ tarih, fiyat }) => {
    const d = new Date(tarih);
    // Fiyatı parse ederken TL formatını temizle
    const parsedFiyat = parseFloat(fiyat.replace(' TL', '').replace(',', '.'));

    if (isNaN(d) || d < start) return;
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

function createHeader(container, defaultKey) {
  const header = document.createElement("div");
  header.id = "priceHeader";

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

  header.appendChild(buttonGroup);
  // Pop-up'ta grafik konteynerinin üstüne ekle
  container.insertBefore(header, container.firstChild);

  return buttonGroup.querySelectorAll("button");
}

function setActive(activeBtn, buttons) {
  buttons.forEach((btn) => btn.classList.remove("active"));
  activeBtn.classList.add("active");
}

function getChartOption(data, stats) {
  const dataPoints = data.map((d) => d.fiyat);
  const minY = Math.min(...dataPoints) - 10;
  const maxY = Math.max(...dataPoints) + 10;

  return {
    grid: { left: "0%", right: "0%", top: "7%", bottom: "0%", containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: (params) => {
        const i = params[0].dataIndex;
        const current = data[i];
        const prev = i > 0 ? data[i - 1] : current;
        const value = current.fiyat;
        const prevVal = prev.fiyat;
        const diff = prevVal !== 0 ? ((value - prevVal) / prevVal) * 100 : 0;
        const pct = Math.abs(diff).toFixed(2);
        const arrow = value > prevVal ? "⬆" : value < prevVal ? "⬇" : "⟷";
        const color = value > prevVal ? "#D32F2F" : value < prevVal ? "#388E3C" : "#333";

        return `<div style="color:${color}; font-weight:bold;">
                  ${arrow} %${pct} - ₺${value.toLocaleString("tr-TR", CONFIG.TL_FORMAT)}
                </div>
                <div style="color:#555;">${formatDateTime(current.date)}</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: data.map((d) => d.date),
    },
    yAxis: {
      type: "value",
      min: minY,
      max: maxY,
      axisLabel: {
        formatter: (val) => `₺${val.toLocaleString("tr-TR")}`,
      },
    },
    series: [
      {
        data: dataPoints,
        type: "line",
        smooth: true,
        lineStyle: { width: 2, color: "#4575f7" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(255, 0, 0, 0.3)" },
              { offset: 1, color: "rgba(0, 255, 0, 0.3)" },
            ],
          },
        },
        markPoint: {
          symbol: "pin",
          symbolSize: 16,
          data: [
            {
              type: "max",
              itemStyle: { color: "#ff0000" },
              label: {
                show: true,
                formatter: "En Yüksek: ₺{c}",
                color: "#ff0000",
                position: "left",
              },
            },
            {
              type: "min",
              itemStyle: { color: "#0000ff" },
              label: {
                show: true,
                formatter: "En Düşük: ₺{c}",
                color: "#0000ff",
                position: "left",
              },
            },
          ],
        },
      },
    ],
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