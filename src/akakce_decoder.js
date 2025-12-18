// src/akakce_decoder.js

export function decodePriceData(rawString) {
  if (!rawString || typeof rawString !== 'string') return [];

  const priceHistory = [];
  const tokens = rawString.split(',');

  for (const token of tokens) {
    let daysToRepeat = 0;
    let priceVal = 0;

    // 1. Durum: 'n' harfi ile sıkıştırma (örn: 51991n3)
    if (token.includes('n')) {
      const parts = token.split('n');
      priceVal = parseInt(parts[0], 10);
      daysToRepeat = parseInt(parts[1], 10);
    }
    // 2. Durum: '.' ile sıkıştırma (örn: 69990..)
    else if (token.includes('.')) {
      // Nokta sayısını say
      const dots = (token.match(/\./g) || []).length;
      // Noktaları sil ve sayıya çevir
      priceVal = parseInt(token.replace(/\./g, ''), 10);
      daysToRepeat = dots;
    }
    // 3. Durum: Tek gün
    else {
      priceVal = parseInt(token, 10);
      daysToRepeat = 0;
    }

    if (isNaN(priceVal)) continue;

    // Fiyatı TL'ye çevir (Kuruş -> Lira)
    const finalPrice = priceVal / 100;
    const totalDays = 1 + daysToRepeat;

    for (let i = 0; i < totalDays; i++) {
      priceHistory.push(finalPrice);
    }
  }

  // Tarihleri oluştur (Sondan başa, bugün dahil değil, dün, önceki gün vs?)
  // Python kodunda: today = datetime.now(), geriye doğru gidiyor.
  // Akakçe verisi genellikle bugünden geriye doğrudur.
  // Ancak Python kodu listenin SONUNUN bugün olduğunu varsayarak tersten gidiyor.
  // Lütfen Python kodunu kontrol et:
  // for i in range(len(price_history)): price = price_history[-(i+1)] -> Sondan başa okuyor.
  // date_obj = today - timedelta(days=i) -> Bugün 0, Dün 1...
  
  const today = new Date();
  const datesPrices = [];
  
  // Listeyi tersten geziyoruz (Sondan başa)
  for (let i = 0; i < priceHistory.length; i++) {
    const price = priceHistory[priceHistory.length - 1 - i];
    
    const dateObj = new Date(today);
    dateObj.setDate(today.getDate() - i);
    
    datesPrices.push({
      tarih: dateObj.toISOString(), // ISO formatı daha güvenli
      fiyat: price
    });
  }

  // Kronolojik sıraya çevir
  datesPrices.reverse();

  return datesPrices;
}
