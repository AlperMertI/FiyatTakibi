// price-utils.js
export function parsePrice(priceString) {
    if (!priceString) return NaN;
    const cleanedString = priceString.replace(/[^\d,.]/g, "").replace(".", "").replace(",", ".");
    return parseFloat(cleanedString);
}