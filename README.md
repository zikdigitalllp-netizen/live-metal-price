
# ZikMetal

**ZikMetal** is a Shopify app that enables dynamic pricing for silver jewelry based on live MCX (Multi Commodity Exchange) silver rates. Automatically update product prices in your Shopify store as silver rates change, with configurable profit margins, making charges, GST, and shipping costs per product.

## Features

- **Live MCX Silver Rate Tracking**: Fetches real-time silver prices from [metals.dev](https://metals.dev)
- **Time-of-Day Aware Pricing**: Automatically switches between AM/PM MCX slots based on IST
- **Custom Pricing Formula**:
  ```
  1. Metal Value = Live Silver Price × Weight (grams)
  2. Vendor Cost = Metal Value + Making Charges
  3. Profit Amount = Vendor Cost × (Profit % / 100)
  4. Selling Price (Before GST) = Vendor Cost + Profit Amount
  5. GST Amount = Selling Price Before GST × (GST % / 100)
  6. Final Price = Selling Price Before GST + GST Amount + Shipping
  ```
- **Per-Product Configuration**: Store pricing attributes in Shopify Product Metafields
- **App-Wide Defaults**: Configure default values for all products
- **Automatic Price Sync**: Push calculated prices to Shopify variant prices
- **Cache Optimization**:
  - Fetches new rates only twice daily (at 9 AM and 9 PM IST)
  - Caches last-good value for resilience
  - NodeCache for fast in-memory caching
- **Custom Silver Price Option**: Override live rate with a custom price for testing or special scenarios
- **Storefront Integration**: Live price block for product pages using Shopify Theme App Extension

## Tech Stack

- **Backend**: Express.js + Node.js
- **Frontend**: React + Vite + Shopify Polaris
- **Session Storage**: SQLite
- **Pricing Data Storage**: Shopify Product Metafields (namespace: `zikmetal`)
- **Shopify Integration**:
  - Shopify App Express
  - Shopify Admin GraphQL API
  - App Bridge
  - Theme App Extensions
- **External API**: [metals.dev](https://metals.dev) for live MCX silver rates

## Quick Start

### Prerequisites

1. Node.js (>= 16.13.0)
2. Shopify Partner Account
3. Shopify Development Store
4. metals.dev API key (for live silver rates)

### Installation

1. Clone or download the project
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your Shopify app credentials in the environment (follow Shopify CLI instructions)

### Development

Run the app in development mode:

```bash
npm run dev
```

This will:
- Start the backend server on port 3000
- Launch the frontend dev server
- Create an ngrok tunnel for Shopify to connect to your local app
- Open the Shopify Partners dashboard to install the app on your test store

### Project Structure

```
.
├── extensions/
│   └── zikmetal-storefront/     # Shopify Theme App Extension for live price block
│       ├── assets/
│       ├── blocks/
│       ├── locales/
│       └── shopify.extension.toml
├── web/
│   ├── frontend/                # React admin interface
│   │   ├── components/
│   │   ├── pages/
│   │   ├── lib/
│   │   └── ...
│   ├── services/                # Core business logic
│   │   ├── db.js                # SQLite database setup
│   │   ├── metals-api.js        # MCX silver rate fetching
│   │   ├── pricing.js           # Pricing calculation formula
│   │   ├── product-config.js    # Product metafields management
│   │   ├── product-pricing.js   # Product price fetching
│   │   ├── price-sync.js        # Sync prices to Shopify
│   │   ├── settings.js          # App settings management
│   │   └── proxy-auth.js        # App proxy authentication
│   ├── index.js                 # Express server entry point
│   ├── shopify.js               # Shopify app configuration
│   ├── webhooks.js              # Shopify webhook handlers
│   └── proxy.js                 # App proxy endpoints
├── shopify.app.toml             # Shopify app configuration
└── package.json
```

## Usage

1. **Install the App**: Install ZikMetal on your Shopify store
2. **Configure Settings**:
   - Add your metals.dev API key
   - Set default pricing attributes (weight, making charges, GST, profit, shipping)
   - Enable auto-sync if desired
3. **Configure Products**:
   - For each silver jewelry product, enable dynamic pricing
   - Set product-specific pricing attributes (or use defaults)
4. **Sync Prices**: Manually sync prices or let the auto-sync feature handle it
5. **Add Storefront Block**: Add the "Live Price" block to your product pages in the Shopify Theme Editor

## License

UNLICENSED

