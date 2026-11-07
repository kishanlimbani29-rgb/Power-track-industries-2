# Power Track – Real-Time Inventory & Recipe Management

Power Track is a multi-device inventory and production app for **Power Track Industries (PTI)**. It tracks raw materials and finished goods in real time, consumes raw materials automatically through recipes (bill of materials), records every stock change in an append-only ledger, and handles sales and purchases with GST invoices. Access is controlled per user through roles and permissions.

It is a React + TypeScript web app, installable as a PWA, with Firebase (Auth + Firestore) as the backend and a small Express server that calls the Gemini API to read photographed bills.

## Features

| Area | What it does |
| --- | --- |
| **Inventory & Stock** | Raw materials, semi-finished and finished goods with SKU, unit, cost, selling price, minimum stock and location. Excel/CSV bulk import. |
| **Recipes & BOM** | Recipes that define which raw materials (and how much) make one batch of a finished product. Excel/CSV import. |
| **Batch Production** | Run a recipe × N batches: raw materials are deducted, finished goods are added, and batch cost is calculated. Batches can be voided with a reason. |
| **Sales & Purchase** | Sales and purchase entries, returns, GST rates (0/5/12/18/28%), and PDF invoices, purchase orders and credit/debit notes. Purchase bills can be read from a photo (Gemini OCR). |
| **Audit Reports** | Approval workflow: staff submit production / raw-material-in requests, managers or admins approve or reject. |
| **Stock Movements** | Full history of every stock change (in, out, production consume/yield, adjustment, waste) with who did it and when. |
| **Analytics & Reports** | Stock value, low-stock alerts and business summaries. |
| **Roles & Access Control** | Admin / manager / staff / viewer roles, email invites, pending-approval gate for new sign-ups, and per-role permission toggles. |

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, `motion`, `lucide-react`
- **Backend data & auth:** Firebase Authentication + Cloud Firestore (with security rules)
- **Server:** Express (`server.ts`) – serves the app and the Gemini OCR endpoint
- **AI:** Google Gemini via `@google/genai` (server-side only)
- **Files:** `xlsx` for Excel import/export, a built-in lightweight PDF writer for invoices
- **PWA:** `vite-plugin-pwa` (installable, works offline for cached assets)
- **Tests:** Node's built-in test runner via `tsx`

## Project structure

```
power-track-industries-2/
├── index.html                  # HTML entry point for Vite
├── server.ts                   # Express server: /api/health, /api/ocr-bill (Gemini), serves the app
├── vite.config.ts              # Vite + React + Tailwind + PWA manifest/caching config
├── tsconfig.json
├── package.json                # Scripts and dependencies
├── bun.lock
├── metadata.json               # Google AI Studio app metadata
├── .env.example                # Environment variables to copy into .env
│
├── firebase-applet-config.json # Firebase web app config (project, auth domain, Firestore DB id)
├── firebase-blueprint.json     # Schema description of every Firestore entity
├── firestore.rules             # Firestore security rules (roles, approval gate, append-only ledgers)
├── security_spec.md            # Security invariants and attack cases the rules must block
│
├── src/
│   ├── main.tsx                # React entry point
│   ├── App.tsx                 # App shell: auth gate, tab routing, permission checks per tab
│   ├── index.css               # Tailwind styles
│   │
│   ├── components/             # One file per screen or modal
│   │   ├── AuthScreen.tsx              # Sign in / sign up / pending-approval screens
│   │   ├── Header.tsx, Sidebar.tsx, Navigation.tsx   # Layout and tab navigation
│   │   ├── InventoryView.tsx           # Inventory & Stock tab
│   │   ├── ItemModal.tsx               # Add / edit an item
│   │   ├── StockAdjustModal.tsx        # Quick stock in/out/adjust/waste
│   │   ├── ExcelImportModal.tsx        # Bulk item import from Excel/CSV
│   │   ├── RecipesView.tsx             # Recipes & BOM tab
│   │   ├── RecipeModal.tsx             # Add / edit a recipe
│   │   ├── RecipeExcelImportModal.tsx  # Bulk recipe import
│   │   ├── ProductionView.tsx          # Batch Production tab
│   │   ├── NewProductionRunPage.tsx    # Start a production run
│   │   ├── ProduceModal.tsx            # Confirm a production batch
│   │   ├── BatchDetailView.tsx         # Details / void a batch
│   │   ├── AuditReportView.tsx         # Approval requests (Audit Reports tab)
│   │   ├── MovementsView.tsx           # Stock Movements ledger
│   │   ├── ProductDetailHistoryView.tsx# Per-item history
│   │   ├── AnalyticsView.tsx           # Analytics & Reports tab
│   │   ├── TeamView.tsx                # Roles & Access Control tab (users, invites, permissions)
│   │   ├── DeviceShareModal.tsx        # Share the app link to other devices
│   │   ├── PWAInstallModal.tsx         # "Install app" prompt
│   │   └── trade/                      # Sales & Purchase module
│   │       ├── SalesView.tsx           #   Sales, sales returns, invoices
│   │       ├── PurchaseView.tsx        #   Purchases, purchase returns, POs
│   │       ├── PhotoBillModal.tsx      #   Photo of a bill -> Gemini OCR -> purchase entry
│   │       └── TradeUI.tsx             #   Shared UI pieces for the trade screens
│   │
│   ├── context/                # App state and all Firestore reads/writes
│   │   ├── AuthContext.tsx     # Firebase Auth, user profile, role & permission resolution
│   │   ├── InventoryContext.tsx# Items, recipes, movements, batches, audit requests
│   │   └── TradeContext.tsx    # Sales, purchases and their returns
│   │
│   ├── types/inventory.ts      # TypeScript types for every data model
│   ├── utils/
│   │   ├── itemResolver.ts     # Safe quantity parsing and item lookup by id/name/SKU
│   │   ├── tradeMath.ts        # Money rounding and GST helpers
│   │   ├── tradePdf.ts         # Dependency-free PDF writer (works offline / in the APK)
│   │   ├── tradeDocuments.ts   # Invoice, PO and credit/debit note layouts
│   │   └── fileDownload.ts     # Cross-platform file download (desktop, mobile, iframe)
│   ├── hooks/usePWAInstall.ts  # Handles the browser's install-app prompt
│   ├── firebase/config.ts      # Initialises Firebase from firebase-applet-config.json
│   └── data/seedData.ts        # Sample items, recipes and history
│
├── public/                     # Static files served as-is
│   ├── logo.png, pti-logo.png, favicon.png, icon.svg, pwa-*.png   # Branding and PWA icons
│   ├── manifest.json
│   ├── power_track_inventory_template.(csv|xlsx)     # Download templates for item import
│   ├── power_track_recipe_bom_template.(csv|xlsx)    # Download templates for recipe import
│   └── assets/aistudio/        # Reference screenshots/images uploaded during AI Studio work
│
├── scripts/
│   ├── generate-template.js         # Regenerates the inventory import template
│   └── generate-recipe-template.js  # Regenerates the recipe/BOM import template
│
├── tests/inventory.test.ts     # Unit tests: item resolver, sanitiser, batch maths, access invariants
│
└── .aistudio/                  # Google AI Studio working files (plans, temp media) – not app code
```

### Firestore collections

`users`, `invites`, `items`, `recipes`, `movements`, `batches`, `settings`, `audit_requests`, `counters`, `sales`, `sales_returns`, `purchases`, `purchase_returns`.

`movements` and `batches` are append-only: records can be created but never edited or deleted. See `firestore.rules` and `security_spec.md` for the full access policy.

## How the pieces fit together

1. **`App.tsx`** waits for `AuthContext` to sign the user in and load their profile. Pending or suspended users stay on `AuthScreen`.
2. The user's **role** is turned into a set of **permissions** (e.g. `canAdjustStock`, `canEditRecipes`, `canViewSalesOption`). `App.tsx` and `Navigation.tsx` only show the tabs those permissions allow.
3. Each tab's view reads and writes data through a **context** (`InventoryContext` or `TradeContext`), which talks to Firestore and keeps every open device in sync in real time.
4. Every change to stock writes a **movement** record, so the ledger always explains the current quantity.
5. **Firestore rules** enforce the same permissions on the server, so the UI checks are not the only protection.
6. For bill photos, the browser sends the image to **`/api/ocr-bill`** on the Express server, which calls Gemini and returns the extracted line items.

## Getting started

**Requirements:** Node.js 20+ (or Bun), and a Firebase project with Authentication and Firestore enabled.

```bash
# 1. Install dependencies
npm install

# 2. Create your env file and add your Gemini API key
cp .env.example .env
#    GEMINI_API_KEY=...   (needed only for photo-bill OCR)
#    APP_URL=...          (the URL where the app is hosted)

# 3. Run the dev server (Express + Vite) on http://localhost:3000
npm run dev
```

To use your own Firebase project, update `firebase-applet-config.json` and deploy `firestore.rules` to that project.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm start` | Start the Express server with Vite (port 3000, or `PORT`) |
| `npm run build` | Build the production app into `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | Type-check with `tsc --noEmit` |
| `npm test` | Run the unit tests in `tests/inventory.test.ts` |
| `npm run clean` | Remove `dist/` and compiled server output |

In production (`NODE_ENV=production`), `server.ts` serves the built files from `dist/`.

## Notes

- This project was built in **Google AI Studio**. The `.aistudio/` folder and `metadata.json` belong to that environment and are not needed to run the app.
- The repo does not yet contain a GitHub Actions workflow for building an Android APK; the app can be installed on phones as a PWA.
