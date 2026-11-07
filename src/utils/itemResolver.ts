import { InventoryItem } from '../types/inventory';

/**
 * Safely parses the on-hand quantity of an inventory item as a number.
 * Handles strings, numbers, undefined, null, and NaN.
 */
export function getItemQuantity(item?: InventoryItem | null): number {
  if (!item) return 0;
  const q = Number(item.quantity);
  return isNaN(q) || q < 0 ? 0 : q;
}

export interface ItemLookupQuery {
  rawItemId?: string;
  rawItemName?: string;
  name?: string;
  id?: string;
  sku?: string;
}

/**
 * Resolves an inventory item strictly by its unique item ID.
 * NO fuzzy name matching, substring, prefix, or normalized matching is used,
 * preventing recipes or production runs from silently switching to unintended items.
 */
export function resolveInventoryItem(
  items: InventoryItem[],
  query?: ItemLookupQuery | null
): InventoryItem | undefined {
  if (!query || !items || items.length === 0) return undefined;

  const targetId = (query.rawItemId || query.id || '').trim();
  if (!targetId) return undefined;

  return items.find((i) => i.id === targetId);
}

/**
 * Retrieves the available on-hand stock for an exact ingredient requirement by item ID.
 */
export function getAvailableStockForIngredient(
  items: InventoryItem[],
  query?: ItemLookupQuery | null
): { item?: InventoryItem; totalAvailable: number } {
  const item = resolveInventoryItem(items, query);
  if (!item) {
    return { item: undefined, totalAvailable: 0 };
  }

  return { item, totalAvailable: getItemQuantity(item) };
}
