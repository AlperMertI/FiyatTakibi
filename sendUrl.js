//background > sendUrl.js

export async function sendPriceChange(productId, newPrice) {
  const response = await fetch("https://amazon.aft.web.tr/UpdatePriceUser.php", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({urun_id: productId, fiyat: newPrice}),
  });

  if (!response.ok) {
    console.log(`Veri gönderilemedi`);
    throw new Error(`Veri gönderilemedi, durum kodu: ${response.status}`);
  }
  //console.log(`Veri gönderildi: urun_id=${productId}, fiyat=${newPrice}`);
  return true;
}

export async function saveFromChart(asin) {
  try {
    const response = await fetch("https://amazon.aft.web.tr/SaveFromChart.php", {
      method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: `asin=${encodeURIComponent(asin)}`,
    });
    if (!response.ok) {
      throw new Error(`Sunucu hatası: ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    console.error("SaveFromChart isteği başarısız:", error);
    throw error;
  }
}
