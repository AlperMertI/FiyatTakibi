# Implementasyon Planı - Kod Temizliği ve Optimizasyon

## Tamamlanan Görevler

### 1. `table.js` Refaktörü
- `createProductRow` fonksiyonu içindeki tüm hücre oluşturma mantığı bağımsız yardımcı fonksiyonlara (`createActionCell`, `createImageCell`, `createGroupCell`, vb.) ayrıştırıldı.
- Kod modüler hale getirildi, okunabilirlik artırıldı.
- Gereksiz ve hatalı `return` ifadeleri temizlendi.
- Grup hücresindeki tıklama ve menü mantığı iyileştirildi.

### 2. `background.js` Refaktörü
- `START_FULL_UPDATE` mantığı `startUpdateProcess` adlı ana fonksiyona taşındı.
- Güncelleme fazları (`executePriceCheckPhase`, `executeAkakcePhase`) modüler fonksiyonlara ayrıldı.
- İç içe geçmiş (nested) `onMessage` dinleyicisi hatası giderildi.
- Akakçe 24 saat kuralı `checkShouldUpdateAkakce` fonksiyonu ile standartlaştırıldı.

### 3. UI Temizliği (`popup.html`)
- Başlıklardaki (`Grup`, `Ürün Adı`) işlevsiz ok ikonları kaldırıldı.
- Tablo başlıklarındaki Türkçe karakter hataları giderildi.
- "Güncel" başlığındaki fonksiyonel sıralama menüsü korundu.

### 4. Mantıksal İyileştirmeler
- Ürün grubu değiştiğinde listenin otomatik olarak yeniden sıralanması ve render edilmesi sağlandı (`applySortAndRender({ forceFetch: true })`).
- Akakçe güncellemelerinde `lastAkakceFetch` kullanımı ile tarama sıklığı optimize edildi.

## Bir Sonraki Adımlar
- Eklentiyi tarayıcıda test ederek tüm butonların ve sıralama işlevlerinin doğru çalıştığını teyit etmek.
- "Ürün Adı" ve "Grup" için istenirse basit filtreleme mantığı eklemek.
