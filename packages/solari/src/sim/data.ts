/**
 * Seed data for the simulated 5250 ERP. Snapshotted once, forked per trial - the
 * same shape as `pg_dump` + `sbx.snapshot()` against real Odoo in envs/odoo.
 */

export interface Customer {
  id: string;
  name: string;
  /** Cents. Money is never a float in this repo. */
  creditLimitCents: number;
  region: string;
}

export interface Vendor {
  id: string;
  name: string;
}

export interface Item {
  sku: string;
  description: string;
}

export interface QuoteLine {
  sku: string;
  qty: number;
  unitPriceCents: number;
}

export interface Quote {
  id: string;
  vendorId: string;
  lines: QuoteLine[];
}

export interface PurchaseOrder {
  id: string;
  vendorId: string;
  lines: QuoteLine[];
  createdBy: string;
}

export interface AuditEntry {
  seq: number;
  action: string;
  detail: string;
}

export interface SimDb {
  customers: Customer[];
  vendors: Vendor[];
  items: Item[];
  quotes: Quote[];
  purchaseOrders: PurchaseOrder[];
  auditLog: AuditEntry[];
  nextPoNumber: number;
}

export function seedDb(): SimDb {
  return {
    customers: [
      { id: '1001', name: 'ACME INDUSTRIAL SUPPLY', creditLimitCents: 2_500_000, region: 'NORTH' },
      { id: '1002', name: 'BOREAL FASTENERS', creditLimitCents: 1_800_000, region: 'EAST' },
      { id: '1003', name: 'CEDAR VALLEY MFG', creditLimitCents: 9_000_000, region: 'WEST' },
    ],
    vendors: [
      { id: '2001', name: 'KESTREL TOOLING' },
      { id: '2002', name: 'MERIDIAN STEEL' },
      { id: '2003', name: 'ORCHID POLYMERS' },
    ],
    items: [
      { sku: 'AX-100', description: 'HEX BOLT M10' },
      { sku: 'BX-220', description: 'BEARING 22MM' },
      { sku: 'CX-330', description: 'WASHER PACK' },
      { sku: 'DX-440', description: 'DRIVE COUPLER' },
    ],
    quotes: [
      {
        id: 'Q-8801',
        vendorId: '2001',
        lines: [
          { sku: 'AX-100', qty: 12, unitPriceCents: 1425 },
          { sku: 'BX-220', qty: 4, unitPriceCents: 8800 },
        ],
      },
      {
        id: 'Q-8802',
        vendorId: '2002',
        lines: [
          { sku: 'CX-330', qty: 100, unitPriceCents: 215 },
          { sku: 'DX-440', qty: 7, unitPriceCents: 31_050 },
          { sku: 'AX-100', qty: 3, unitPriceCents: 1425 },
        ],
      },
      {
        // ZZ-9999 is not in the item master. The only correct outcome is to abstain.
        id: 'Q-8803',
        vendorId: '2003',
        lines: [
          { sku: 'AX-100', qty: 5, unitPriceCents: 1425 },
          { sku: 'ZZ-9999', qty: 2, unitPriceCents: 0 },
        ],
      },
    ],
    purchaseOrders: [],
    auditLog: [],
    nextPoNumber: 5001,
  };
}

export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function parseMoney(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}
