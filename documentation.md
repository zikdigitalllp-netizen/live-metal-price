
## Table of Contents
1. [Overview](#overview)
2. [Key Features](#key-features)
3. [Core Pricing Formula](#core-pricing-formula)
4. [Metafields](#metafields)
5. [Tech Stack](#tech-stack)
6. [System Architecture](#system-architecture)
7. [Installation & Setup](#installation--setup)
8. [Business Value](#business-value)
9. [Target Audience](#target-audience)

---

## Overview
ZikMetal Live Pricing Engine is a production-grade Shopify app built for **silver jewellery stores** that automatically calculates and updates product prices in real-time based on live MCX (Multi Commodity Exchange) silver rates from India.

---

## Key Features

### 🛒 For Storefronts (Customers)
1. **Dynamic Pricing Display**: Replaces Shopify's fixed prices (set to dummy value ₹1) with live calculated prices on:
   - Product Detail Pages (PDPs)
   - Collection Pages
   - Any page with product price elements
2. **No Fixed Prices Visible**: The Shopify base price is never shown to customers
3. **Real-Time Updates**: Prices refresh automatically every 30 seconds
4. **Fallback Mechanism**: If the API fails, falls back to Shopify's base price
5. **Price Comparison**: Shows both original dummy price (strikethrough) and new dynamic price

### 📊 For Merchants (Shopify Admin)
1. **Live Silver Rate Dashboard**: Shows current MCX silver rate, last updated time, and force-refresh button
2. **Product Management**: Lists all products with:
   - Product name
   - Dynamic pricing status
   - Shopify base price
   - Calculated price
   - Weight
3. **Product Metafield Configuration**: Edit pricing settings per product
4. **Settings Page**: Configure API keys, default values, and test API connection
5. **Debug Tools**: Detailed logging and debug sections to troubleshoot

---

## Core Pricing Formula (Rigid, Unmodified)
```
Base Metal Value = Weight (grams) × Live Silver Rate
Making Cost = Weight (grams) × Making Charge per Gram
Subtotal = Base Metal Value + Making Cost
Profit = Subtotal × (Profit Percent / 100)
Pre-GST Price = Subtotal + Profit
GST Amount = Pre-GST Price × (GST Percent / 100)
Final Price = Pre-GST Price + GST Amount + Shipping Cost
```
Round final price to 2 decimal places

---

## Metafields

### Required Product Metafields
All metafields are in the `custom` namespace attached to **products** (owner type: `product`).

| Metafield Key | Type | Description | Default | Formula Usage |
|---|---|---|---|---|
| `dynamic_pricing_enabled` | Boolean | Enable/disable dynamic pricing for product | false | Toggles if product uses dynamic pricing |
| `weight_grams` | Weight | Product weight in grams | 0 | Base metal value calculation |
| `making_charge_per_gram` | Money | Labour/manufacturing cost per gram (INR) | 0 | Making cost calculation |
| `gst_percent` | Number (Decimal) | GST percentage | App default (3%) | Tax calculation |
| `profit_percent` | Number (Decimal) | Profit margin percentage | App default (24%) | Profit calculation |
| `shipping_cost` | Money | Flat shipping cost (INR) | App default (₹100) | Added to final price |

### App-Wide Configuration Metafield
- **Namespace**: `zikmetal`
- **Key**: `app_settings`
- **Owner Type**: Shop
- **Type**: JSON
- **Description**: Stores global app settings
- **JSON Schema**:
  ```json
  {
    "metals_api_key": "5FDWBSS8CLAPL6FTZLKJ384FTZLKJ",
    "default_gst_percent": 3,
    "default_profit_percent": 24,
    "default_shipping_cost": 100,
    "last_sync_time": "2026-06-26T12:34:56.789Z",
    "selected_product_ids": ["1234567890123"]
  }
  ```

### Metafield Priority & Fallback Logic
1. Product-specific metafields (highest priority)
2. App-wide defaults (from Settings)
3. Hardcoded defaults:
   - `weight_grams`: 0
   - `making_charge_per_gram`: 0
   - `gst_percent`: 3%
   - `profit_percent`: 24%
   - `shipping_cost`: ₹100

### Backward Compatibility
- Legacy metafield `zikmetal.pricing_config` (single JSON field) still supported
- App updates both individual custom metafields and legacy JSON field when saving product config

---

## Tech Stack
1. **Backend**:
   - Node.js + Express
   - Shopify API (REST & OAuth)
   - Metals.dev API (for live MCX rates)
   - In-memory caching (30 second TTL) for silver rates
2. **Frontend (Admin)**:
   - React
   - Shopify Polaris (design system)
   - React Query (state management & caching)
   - React Router (file-based routing)
3. **Storefront Extension**:
   - Theme App Extension + Shopify App Proxy
   - Vanilla JavaScript
   - Mutation Observer (for dynamic content like infinite scroll/AJAX)

---

## System Architecture

### Data Flow
```
Storefront → Shopify App Proxy → Backend API → Shopify API + Metals.dev API
```

### Key Endpoints
| Endpoint | Method | Description | Auth Required |
|---|---|---|---|
| `/api/mcx-rate` | GET | Get current MCX silver rate | Yes (admin) |
| `/api/mcx-rate/refresh` | POST | Force refresh silver rate, clear cache | Yes (admin) |
| `/api/products/dynamic-pricing` | GET | Get all products with calculated prices | Yes (admin) |
| `/api/product/:id/price` | GET | Get price for single product | App Proxy (public) |
| `/api/products/prices?ids=...` | GET | Bulk price calculation (comma-separated IDs) | Both admin & App Proxy |
| `/apps/zikmetal-live-price/api/*` | * | App Proxy endpoints for storefront | No (public) |
| `/api/test-api` | POST | Test Metals.dev API connection | Yes (admin) |
| `/api/settings` | GET/PUT | Get/save app-wide settings | Yes (admin) |

---

## Installation & Setup

### Requirements
1. Node.js
2. Shopify Partner Account
3. Shopify Development Store
4. Metals.dev API Key (for live silver rates)

### Local Development
1. Clone this repository
2. Run `npm install`
3. Create a `.env` file with your Shopify API credentials
4. Run `npm run dev` to start the development server

---

## Business Value
- **Automation**: No manual price updates needed during silver rate volatility
- **Accuracy**: Prices strictly based on live market data
- **Performance**: Caching, bulk API calls, and optimized storefront script
- **Scalability**: Designed to handle thousands of products
- **Compliance**: Built-in GST calculation for Indian market requirements

---

## Target Audience
- Shopify store owners selling silver jewellery in India
- Stores needing real-time commodity-based pricing
- Merchants avoiding manual price management during market fluctuations
