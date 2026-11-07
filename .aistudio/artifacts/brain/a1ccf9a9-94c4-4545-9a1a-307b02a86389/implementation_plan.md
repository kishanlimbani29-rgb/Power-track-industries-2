# Product Transaction History: Bank Statement Ledger View

A comprehensive transformation of the product transaction history into a formal, structured bank statement (passbook) format with dedicated columns for Date, Entry Type, In Quantity (Credits), Out Quantity (Debits), and Closing Quantity (Balance).

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The transaction history table will be refactored into a high-clarity **Bank Statement Ledger format**. In addition to the desktop tabular ledger, a mobile-responsive passbook card mode will ensure zero horizontal cutoffs while preserving the strict Date, Entry Type, In, Out, and Closing Balance accounting principles.

- **Ledger Structure**: 5 core statement columns:
  1. `Date`: Formatted transaction timestamp (Date & Time).
  2. `Entry Type & Particulars`: Transaction category badge, narrative reason, reference ID, and user.
  3. `In Quantity`: Stock inflow (Restocks, Production Yields) displayed with `+` in bold emerald.
  4. `Out Quantity`: Stock outflow (Sales, Recipe Usage, Waste) displayed with `-` in bold rose.
  5. `Closing Quantity`: Account stock balance after the transaction in bold monospace.
- **Statement Summary Footer**: A passbook statement footer summarizing total inflows, total outflows, net change, and verified final closing stock.
- **Export Compatibility**: CSV export updated to mirror the bank statement columns (`Date`, `Entry Type`, `Particulars`, `In Quantity`, `Out Quantity`, `Closing Quantity`, `Reference`, `Performed By`).
- **Audit Queue & Firestore Sanitization**: Added recursive `removeUndefinedFields` to sanitize all audit requests, batch production submissions, inventory items, and movements prior to `setDoc`/`updateDoc` writes. Converted audit approvals, rejections, and state updates from strict `updateDoc` / `batch.update` to `setDoc(..., { merge: true })` and `batch.set(..., { merge: true })`, eliminating `No document to update` errors when approving or rejecting requests. Added optimistic rollback and deletion cleanup. Role description texts have also been stripped as requested.
- **Dedicated Full-Page Production Run & Product Adjustments**: Transformed batch production creation from a popup modal into a full-page experience (`NewProductionRunPage.tsx`). Users can customize target finished output yield and freely adjust individual raw material/ingredient quantities up or down with steppers, add extra catalog materials to the batch, or reset to standard formula ratios with real-time stock shortage alerts and dynamic batch costing.

---

## 1. Overview & Core Concept

- **What It Does**: Refactors the product transaction history view in `ProductDetailHistoryView.tsx` into a familiar, financial-grade **Bank Statement Ledger**. Business owners, store managers, and accountants can inspect inventory stock movements just like bank account debits and credits, with immediate verification of in-quantity additions, out-quantity deductions, and running closing balances.
- **Target Audience**: Bakery owners, kitchen supervisors, production managers, and inventory auditors who require transparent, audit-ready accountability for stock movements.
- **Key Value**: Eliminates ambiguity by separating incoming additions and outgoing reductions into two distinct debit/credit columns with a running closing quantity tally on every line.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Opening Statement**: User taps any product from the Inventory & Stock Master list or grid view. The full-page Product Detail & Transaction History view opens.
2. **Statement Header & Passbook Summary**:
   - Account Header: Product Name, SKU ("Account Number"), Unit of Measure, Opening Balance, Total Receipts, Total Dispatches, and Current Balance.
   - Date range and transaction search bar.
3. **Reading Ledger Entries**:
   - Each transaction row displays:
     - **Date**: e.g., `Oct 24, 2026, 08:30 AM` with relative subtext (`2h ago`).
     - **Entry Type & Particulars**: Distinct visual pill (`Restock In`, `Stock Out`, `Recipe Consumed`, `Production Yield`, `Audit Adjustment`, `Waste / Spoilage`), narration note, and operator name.
     - **In Quantity (Credit)**: Green numeric entry (e.g., `+50.0 kg`) or an em-dash (`—`) if non-inflow.
     - **Out Quantity (Debit)**: Red numeric entry (e.g., `-12.5 kg`) or an em-dash (`—`) if non-outflow.
     - **Closing Quantity (Balance)**: Bold running balance (e.g., `65.5 kg`).
4. **Statement Totals Bar**:
   - Fixed ledger summary at the base of the table aggregating Total In, Total Out, and verified Closing Stock.
5. **Statement Export**:
   - "Download Statement (CSV)" button generates a clean statement sheet matching the on-screen ledger.

### Visual Identity & Theme
- **Ledger Typography**: Tabular monospace numbers (`font-mono tracking-tight font-bold`) for numerical columns (`In`, `Out`, `Closing Quantity`) ensuring decimal points align vertically.
- **Color Coding**:
  - `In Quantity`: `text-emerald-700 bg-emerald-50/50`
  - `Out Quantity`: `text-rose-700 bg-rose-50/50`
  - `Closing Quantity`: `text-slate-900 font-extrabold`
- **Passbook Border & Striping**: Clean alternating rows with subtle borders (`border-slate-200/80 hover:bg-slate-50/80 transition`) reminiscent of executive bank statements.

---

## 3. Key Product Decisions & Trade-Offs

- **Explicit In & Out Columns vs Single Net Column**:
  - *Chosen Approach*: Separate "In Quantity" and "Out Quantity" into dedicated columns, mirroring standard banking debit/credit sheets.
  - *Why*: Direct compliance with user requirement and significantly speeds up reconciling receipts vs dispatches.
  - *Alternatives Considered*: A single signed delta column (e.g. `±X`). Rejected because users specifically requested separate In and Out columns like a bank statement.
- **Audit Count / Stock Reconciliation Handling**:
  - *Chosen Approach*: When a physical inventory audit is logged (`adjustment`), if the audit increased stock, the difference is placed in `In Quantity`; if it decreased stock, the difference is placed in `Out Quantity`, with the `Entry Type` badge stating "Audit Count" and details noting the reconciliation.
  - *Why*: Maintains strict mathematical consistency across the In/Out ledger.
- **Mobile Responsive Layout**:
  - *Chosen Approach*: On large screens, renders a high-density bank statement table. On mobile screens, renders a responsive ledger card that explicitly preserves the 5-field structure (`Date`, `Entry Type`, `In Qty`, `Out Qty`, `Closing Qty`) without requiring horizontal scrolling.

---

## 4. Technical Architecture & Component Structure

```
┌────────────────────────────────────────────────────────────────┐
│                    InventoryView.tsx                           │
│  (List / Grid View with persistent selection & click handlers) │
└───────────────────────────────┬────────────────────────────────┘
                                │ taps product
                                ▼
┌────────────────────────────────────────────────────────────────┐
│             ProductDetailHistoryView.tsx (Full Page)           │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ Top Action & Breadcrumb: "← Back to Inventory"             │ │
│ ├────────────────────────────────────────────────────────────┤ │
│ │ Product Header & Passbook Summary Cards                    │ │
│ ├────────────────────────────────────────────────────────────┤ │
│ │ Bank Statement Filter & Search Bar                         │ │
│ ├────────────────────────────────────────────────────────────┤ │
│ │ Bank Statement Ledger Table:                               │ │
│ │ ┌──────────┬──────────────┬─────────┬──────────┬─────────┐ │ │
│ │ │   DATE   │  ENTRY TYPE  │ IN QTY  │ OUT QTY  │ CLOSING │ │ │
│ │ ├──────────┼──────────────┼─────────┼──────────┼─────────┤ │ │
│ │ │ 24 Oct   │ Restock In   │ +50 kg  │    —     │ 65.5 kg │ │ │
│ │ │ 24 Oct   │ Recipe Use   │    —    │ -12.5 kg │ 53.0 kg │ │ │
│ │ └──────────┴──────────────┴─────────┴──────────┴─────────┘ │ │
│ ├────────────────────────────────────────────────────────────┤ │
│ │ Statement Totals Summary Row                               │ │
│ └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### Data Fields Mapping

| Field | Source / Calculation | Example Display |
| :--- | :--- | :--- |
| **Date** | `movement.timestamp` formatted with date, time, and relative badge | `Oct 24, 2026 • 08:30 AM` |
| **Entry Type** | `movement.type` + `movement.reason` + `movement.performedByName` | `[Restock In] Weekly PO #1084` |
| **In Quantity** | If `in` or `production_yield` (or positive adjustment): `movement.quantity` | `+50.0 kg` (Emerald) or `—` |
| **Out Quantity** | If `out`, `production_consume`, `waste` (or negative adjustment): `movement.quantity` | `-12.5 kg` (Rose) or `—` |
| **Closing Quantity** | `movement.newQuantity` | `53.0 kg` (Bold Slate) |

---

## 5. Implementation Steps

1. **Refactor `src/components/ProductDetailHistoryView.tsx`**:
   - Replace the generic movement list with a formal **Bank Statement Ledger Table**.
   - Implement the 5 column headers: `Date`, `Entry Type & Particulars`, `In Quantity`, `Out Quantity`, and `Closing Quantity`.
   - Calculate In and Out quantities for each movement type:
     - `in` / `production_yield`: In = `quantity`, Out = `null`.
     - `out` / `production_consume` / `waste`: In = `null`, Out = `quantity`.
     - `adjustment`: Compare `newQuantity` vs `previousQuantity` to allocate to In or Out accordingly.
   - Format Closing Quantity using `movement.newQuantity` with unit.
   - Add a Statement Totals row at the bottom showing Total In, Total Out, and Net Closing Stock.
2. **Update Statement CSV Export**:
   - Update export function headers and rows to mirror the exact bank statement structure (`Date`, `Entry Type`, `Particulars`, `In Quantity`, `Out Quantity`, `Closing Quantity`, `Performer`, `Reference ID`).
3. **Mobile & Viewport Verification**:
   - Ensure clean wrapping, tabular font alignment, zero horizontal window scroll, and test compilation via `compile_applet` and `lint_applet`.
