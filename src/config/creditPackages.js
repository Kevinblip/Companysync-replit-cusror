// Server-authoritative catalog for Subscription Usage credit purchases.
//
// This module is the SINGLE source of truth for credit package pricing and
// amounts. It is imported by BOTH:
//   - the frontend (src/pages/SubscriptionUsage.jsx) for display, and
//   - the server (vite-stripe-plugin.js) which looks up price + grant amounts
//     here when creating the Stripe Checkout session.
//
// Because the server prices every checkout from this file, the browser can
// only pick a package by index — it can never dictate the price or the number
// of credits granted. Keep this a plain data module (no JSX / no imports) so
// it resolves as ESM in both the Vite frontend and the Node server plugin.

export const CREDIT_PACKAGES = {
  ai_interaction: [
    { amount: 500, price: 29, label: "500 AI Credits", perUnit: "$0.058/credit" },
    { amount: 1000, price: 49, label: "1,000 AI Credits", perUnit: "$0.049/credit", popular: true },
    { amount: 2500, price: 99, label: "2,500 AI Credits", perUnit: "$0.040/credit" },
    { amount: 5000, price: 179, label: "5,000 AI Credits", perUnit: "$0.036/credit", best: true },
  ],
  sms: [
    { amount: 200, price: 19, label: "200 SMS Credits", perUnit: "$0.095/sms" },
    { amount: 500, price: 39, label: "500 SMS Credits", perUnit: "$0.078/sms", popular: true },
    { amount: 1000, price: 69, label: "1,000 SMS Credits", perUnit: "$0.069/sms" },
    { amount: 2500, price: 149, label: "2,500 SMS Credits", perUnit: "$0.060/sms", best: true },
  ],
  call_minute: [
    { amount: 25, price: 19, label: "25 Call Minutes", perUnit: "$0.76/min" },
    { amount: 50, price: 34, label: "50 Call Minutes", perUnit: "$0.68/min", popular: true },
    { amount: 100, price: 59, label: "100 Call Minutes", perUnit: "$0.59/min" },
    { amount: 250, price: 129, label: "250 Call Minutes", perUnit: "$0.52/min", best: true },
  ],
};

// Bundle deals — buy all three credit types together at a discount vs. buying
// each package on its own. regularPrice is the sum of the equivalent individual
// packages so the savings shown to the customer are honest.
export const BUNDLE_PACKAGES = [
  { name: "Starter Bundle", ai: 500, sms: 200, call: 25, price: 54, regularPrice: 67 },
  { name: "Pro Bundle", ai: 1000, sms: 500, call: 50, price: 99, regularPrice: 122, popular: true },
  { name: "Business Bundle", ai: 2500, sms: 1000, call: 100, price: 179, regularPrice: 227, best: true },
];

// Maps the frontend buyType (single-credit purchases) to the real DB column on
// the companies table that the paid webhook increments.
export const CREDIT_TYPE_TO_FIELD = {
  ai_interaction: "ai_credits_purchased",
  sms: "sms_credits_purchased",
  call_minute: "call_credits_purchased",
};
