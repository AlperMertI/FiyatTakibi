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

    if (!Array.isArray(mergedData) || mergedData.length < 2) return;

    // Mesaj ve sınıflandırma (mevcut mantık)
    const { mesaj, sınıf } = getPriceMessage(mergedData, nowPrice);

    const labels = mergedData.map((d) => new Date(d.tarih).toLocaleDateString("tr-TR"));
    const dataPoints = mergedData.map((d) => parseFloat(d.fiyat.replace(' TL', '').replace(',', '.')));
    const rawEntries = mergedData;

    insertBox(sınıf, mesaj, labels, dataPoints, rawEntries);
  } catch (err) {
    console.error("getPriceHistory hata:", err);
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

function insertBox(cls, html, labels, dataPoints, rawEntries) {
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

  insertChartAfterPPD(labels, dataPoints, rawEntries);
}

//grafik ekleme
function insertChartAfterPPD(labels, dataPoints, rawEntries) {
  const ppdEndDiv = document.querySelector("#ppd") || document.querySelector("#hover-zoom-end");
  if (!ppdEndDiv) return;

  if (!Array.isArray(labels) || labels.length === 0 || !Array.isArray(dataPoints) || dataPoints.length === 0) {
    const noDataDiv = document.createElement("div");
    noDataDiv.id = "chartDiv";
    noDataDiv.className = "no-data";
    noDataDiv.textContent = "Grafik verisi bulunamadı.";
    ppdEndDiv.insertAdjacentElement("afterend", noDataDiv);
    return;
  }

  const chartDiv = document.createElement("div");
  chartDiv.id = "chartDiv";
  chartDiv.className = "chart-area";

  const container = document.createElement("div");
  container.id = "priceChartContainer";
  container.className = "chart-container";
  container.appendChild(chartDiv);

  const disclaimer = document.createElement("div");
  disclaimer.className = "chart-disclaimer"; // CSS'i styles.css'e eklenecek
  disclaimer.textContent = "Grafik verileri, Yanyo (yaniyo.com) ve AFT sunucuları tarafından sağlanmaktadır. Veri doğruluğu veya sürekliliği garanti edilmez.";
  container.appendChild(disclaimer); // Bilgilendirmeyi container'a ekle

  ppdEndDiv.insertAdjacentElement("afterend", container);

  const chart = echarts.init(chartDiv);
  const minY = Math.min(...dataPoints) - 10;
  const maxY = Math.max(...dataPoints) + 10;

  chart.setOption({
    grid: { left: "0%", right: "0%", bottom: "0%", top: "5%", containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: ({ [0]: { dataIndex: i } }) => {
        const e = rawEntries[i];
        const d = new Date(e.tarih);
        const date = d.toLocaleDateString("tr-TR");
        const time = d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const val = parseFloat(e.fiyat.replace(' TL', '').replace(',', '.')).toFixed(2);
        const prevEntry = i > 0 ? rawEntries[i - 1] : null;
        const prev = prevEntry ? parseFloat(prevEntry.fiyat.replace(' TL', '').replace(',', '.')) : parseFloat(val);

        const diff = prev !== 0 ? ((val - prev) / prev) * 100 : 0;
        const pct = Math.abs(diff).toFixed(2);
        const up = val > prev,
          down = val < prev;
        const arrow = up ? "⬆" : down ? "⬇" : "⟷";
        const color = up ? "#D32F2F" : down ? "#388E3C" : "#333";

        return `<div style="color:${color};font-weight:bold;">${arrow} %${pct} - ₺${val}</div>
                <div style="color:#555;">${date} ${time}</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { interval: Math.floor(labels.length / 10) },
    },
    yAxis: {
      type: "value",
      min: minY,
      max: maxY,
      axisLabel: { formatter: (v) => `₺${Math.round(v)}` },
    },
    series: [
      {
        data: dataPoints,
        type: "line",
        smooth: true,
        lineStyle: { color: "#4575f7" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(255,0,0,0.3)" },
              { offset: 1, color: "rgba(0,255,0,0.3)" },
            ],
          },
        },
        markPoint: {
          symbol: "pin",
          symbolSize: 21,
          data: [
            { type: "max", itemStyle: { color: "#ff0000" }, label: { formatter: "En Yüksek: ₺{c}", color: "#ff0000", position: "left" } },
            { type: "min", itemStyle: { color: "#0000ff" }, label: { formatter: "En Düşük: ₺{c}", color: "#0000ff", position: "left" } },
          ],
        },
      },
    ],
  });
}

window.getPriceHistory = getPriceHistory;