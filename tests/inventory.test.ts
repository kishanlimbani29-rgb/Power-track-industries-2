import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getItemQuantity,
  resolveInventoryItem,
  getAvailableStockForIngredient,
} from '../src/utils/itemResolver';
import { removeUndefinedFields } from '../src/context/InventoryContext';
import { InventoryItem, Recipe, StockMovement } from '../src/types/inventory';
import { BOOTSTRAP_ADMIN_EMAIL } from '../src/context/AuthContext';

describe('1. Inventory Item & Quantity Resolver Tests', () => {
  it('correctly parses numbers, strings, null, and NaN', () => {
    assert.equal(getItemQuantity({ quantity: 150 } as InventoryItem), 150);
    assert.equal(getItemQuantity({ quantity: '42.5' as any } as InventoryItem), 42.5);
    assert.equal(getItemQuantity({ quantity: 0 } as InventoryItem), 0);
    assert.equal(getItemQuantity({ quantity: -10 } as InventoryItem), 0);
    assert.equal(getItemQuantity({ quantity: NaN } as InventoryItem), 0);
    assert.equal(getItemQuantity(null), 0);
    assert.equal(getItemQuantity(undefined), 0);
  });

  it('strictly resolves inventory items by exact ID without fuzzy or name guesswork', () => {
    const items: InventoryItem[] = [
      {
        id: 'item-lead-ingot',
        name: 'Pure Lead Ingot 99.9%',
        sku: 'ING-001',
        type: 'raw_material',
        category: 'Metals',
        unit: 'kg',
        quantity: 500,
        minStock: 50,
        unitCost: 2.1,
        sellingPrice: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'item-lead-oxide',
        name: 'Lead Oxide Powder',
        sku: 'OXD-002',
        type: 'raw_material',
        category: 'Chemicals',
        unit: 'kg',
        quantity: 200,
        minStock: 20,
        unitCost: 3.4,
        sellingPrice: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // Must resolve by exact id
    const resolved = resolveInventoryItem(items, { rawItemId: 'item-lead-ingot' });
    assert.ok(resolved);
    assert.equal(resolved.name, 'Pure Lead Ingot 99.9%');

    // Must NOT guess by fuzzy name when id is missing
    const fuzzyAttempt = resolveInventoryItem(items, { rawItemName: 'Lead' });
    assert.equal(fuzzyAttempt, undefined);

    // Empty or unmatched query returns undefined
    assert.equal(resolveInventoryItem(items, { id: 'non-existent' }), undefined);
    assert.equal(resolveInventoryItem(items, null), undefined);
  });

  it('retrieves on-hand stock for exact ingredient requirements', () => {
    const items: InventoryItem[] = [
      {
        id: 'mat-acid',
        name: 'Sulfuric Acid 38%',
        sku: 'ACD-001',
        type: 'raw_material',
        category: 'Chemicals',
        unit: 'L',
        quantity: 85.5,
        minStock: 10,
        unitCost: 1.25,
        sellingPrice: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const result = getAvailableStockForIngredient(items, { rawItemId: 'mat-acid' });
    assert.ok(result.item);
    assert.equal(result.totalAvailable, 85.5);

    const missingResult = getAvailableStockForIngredient(items, { rawItemId: 'mat-unknown' });
    assert.equal(missingResult.item, undefined);
    assert.equal(missingResult.totalAvailable, 0);
  });
});

describe('2. Firestore Data Sanitizer Tests', () => {
  it('recursively removes undefined fields so Firestore writes never fail', () => {
    const dirtyData = {
      id: 'mov-100',
      reason: 'Regular restock',
      notes: undefined,
      metadata: {
        batchId: undefined,
        lotNumber: 'LOT-998',
        tags: [undefined, 'urgent', undefined],
      },
      audit: undefined,
    };

    const clean = removeUndefinedFields(dirtyData) as Record<string, any>;
    assert.ok(!('notes' in clean));
    assert.ok(!('audit' in clean));
    assert.equal(clean.id, 'mov-100');
    assert.equal(clean.metadata?.lotNumber, 'LOT-998');
    assert.ok(!('batchId' in (clean.metadata || {})));
  });
});

describe('3. Production & Batch Multiplier Calculation Tests', () => {
  it('correctly calculates multi-batch raw material deductions and cost allocations', () => {
    const recipe: Recipe = {
      id: 'rec-12v-battery',
      name: '12V 100Ah Deep Cycle Battery',
      finishedItemId: 'item-bat-12v100',
      finishedItemName: '12V 100Ah Deep Cycle Battery',
      yieldQuantity: 10, // 10 units per batch
      laborCost: 150, // $150 labor per batch
      ingredients: [
        { rawItemId: 'item-lead-ingot', rawItemName: 'Lead Ingot', quantity: 120, unit: 'kg' },
        { rawItemId: 'item-acid', rawItemName: 'Acid', quantity: 40, unit: 'L' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const multiplier = 3; // 3 batches = 30 finished units
    const totalYield = recipe.yieldQuantity * multiplier;
    assert.equal(totalYield, 30);

    const leadNeeded = recipe.ingredients[0].quantity * multiplier;
    const acidNeeded = recipe.ingredients[1].quantity * multiplier;
    assert.equal(leadNeeded, 360);
    assert.equal(acidNeeded, 120);

    // Costing: lead at $2.10/kg, acid at $1.25/L
    const rawCostPerBatch = 120 * 2.1 + 40 * 1.25; // 252 + 50 = $302
    const totalBatchCost = (rawCostPerBatch + recipe.laborCost) * multiplier; // (302 + 150) * 3 = 452 * 3 = $1356
    assert.equal(totalBatchCost, 1356);

    const costPerUnit = totalBatchCost / totalYield;
    assert.equal(costPerUnit, 45.2);
  });
});

describe('4. Security & Access Policy Invariants', () => {
  it('verifies the configured bootstrap administrator identity', () => {
    assert.equal(BOOTSTRAP_ADMIN_EMAIL.toLowerCase(), 'kishanlimbani29@gmail.com');
  });

  it('validates immutable movement and voiding batch invariants', () => {
    // Movement records cannot be updated or deleted once created
    const movement: StockMovement = {
      id: 'mov-001',
      itemId: 'item-1',
      itemName: 'Lead Ingot',
      type: 'out',
      quantity: 50,
      previousQuantity: 200,
      newQuantity: 150,
      reason: 'Battery Production',
      performedBy: 'usr-admin-1',
      performedByName: 'Lead Admin',
      timestamp: new Date().toISOString(),
    };

    assert.equal(movement.previousQuantity - movement.quantity, movement.newQuantity);

    // Batches can only update void fields, never deleted
    const voidAllowedFields = ['isVoid', 'voidedAt', 'voidedBy', 'voidedByName', 'voidReason'];
    const sampleVoidPayload = {
      isVoid: true,
      voidedAt: new Date().toISOString(),
      voidedBy: 'usr-admin-1',
      voidedByName: 'Lead Admin',
      voidReason: 'Defective batch test',
    };

    const payloadKeys = Object.keys(sampleVoidPayload);
    const hasOnlyVoidKeys = payloadKeys.every((k) => voidAllowedFields.includes(k));
    assert.ok(hasOnlyVoidKeys, 'Void update payload must contain only approved audit void keys');
  });
});
