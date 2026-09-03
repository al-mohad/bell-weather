/**
 * Screen model for NORTHWIND 5250.
 *
 * The layout is duplicated here on purpose: this agent is what an RPA script looks
 * like, and an RPA script hard-codes the screen it drives. That is precisely the
 * brittleness the benchmark is built to measure - and precisely what part two's
 * compiler generates automatically from a successful agent trace.
 */
export type ScreenKind =
  | 'MENU'
  | 'CUST_LOOKUP'
  | 'CUST_EDIT'
  | 'QUOTES'
  | 'PO_ENTRY'
  | 'VENDORS'
  | 'SIGNON'
  | 'MODAL'
  | 'UNKNOWN';

export interface FieldPos {
  name: string;
  row: number;
  col: number;
  len: number;
}

export const FIELDS: Record<ScreenKind, FieldPos[]> = {
  MENU: [{ name: 'selection', row: 8, col: 26, len: 1 }],
  CUST_LOOKUP: [{ name: 'custId', row: 4, col: 26, len: 4 }],
  CUST_EDIT: [
    { name: 'name', row: 4, col: 26, len: 30 },
    { name: 'creditLimit', row: 5, col: 26, len: 10 },
    { name: 'region', row: 6, col: 26, len: 6 },
  ],
  PO_ENTRY: [
    { name: 'vendorId', row: 4, col: 26, len: 4 },
    { name: 'item1', row: 8, col: 8, len: 8 },
    { name: 'qty1', row: 8, col: 20, len: 4 },
    { name: 'price1', row: 8, col: 28, len: 8 },
    { name: 'item2', row: 9, col: 8, len: 8 },
    { name: 'qty2', row: 9, col: 20, len: 4 },
    { name: 'price2', row: 9, col: 28, len: 8 },
    { name: 'item3', row: 10, col: 8, len: 8 },
    { name: 'qty3', row: 10, col: 20, len: 4 },
    { name: 'price3', row: 10, col: 28, len: 8 },
  ],
  SIGNON: [{ name: 'password', row: 10, col: 30, len: 8 }],
  QUOTES: [],
  VENDORS: [],
  MODAL: [],
  UNKNOWN: [],
};

export const CELL = { width: 8, height: 16 } as const;

export interface QuoteLine {
  sku: string;
  qty: string;
  price: string;
}

export interface ParsedQuote {
  id: string;
  vendorId: string;
  lines: QuoteLine[];
}

export interface Screen {
  rows: string[];
  kind: ScreenKind;
  message: string;
  values: Record<string, string>;
  focused?: string;
  quotes: ParsedQuote[];
}

function slice(rows: string[], row: number, col: number, len: number): string {
  return (rows[row] ?? '').slice(col, col + len);
}

function fieldValue(rows: string[], field: FieldPos): string {
  return slice(rows, field.row, field.col, field.len).replace(/_+$/, '').trim();
}

function detectKind(rows: string[]): ScreenKind {
  const text = rows.join('\n');
  if (text.includes('SYSTEM NOTICE')) return 'MODAL';
  // Detect by a field unique to the screen, never by the status line: status text
  // is application copy and will happily contain any phrase you match on.
  if (text.includes('Password . . . . . :')) return 'SIGNON';
  if (text.includes('MAIN MENU')) return 'MENU';
  if (text.includes('CUSTOMER MAINTENANCE')) {
    return text.includes('Credit limit') ? 'CUST_EDIT' : 'CUST_LOOKUP';
  }
  if (text.includes('VENDOR QUOTES')) return 'QUOTES';
  if (text.includes('PURCHASE ORDER ENTRY')) return 'PO_ENTRY';
  if (text.includes('VENDOR MASTER')) return 'VENDORS';
  return 'UNKNOWN';
}

function parseQuotes(rows: string[]): ParsedQuote[] {
  const quotes: ParsedQuote[] = [];
  let current: ParsedQuote | undefined;
  for (let row = 4; row < 22; row++) {
    const line = rows[row] ?? '';
    const id = line.slice(1, 9).trim();
    if (/^Q-\d+$/.test(id)) {
      current = { id, vendorId: line.slice(10, 14).trim(), lines: [] };
      quotes.push(current);
      continue;
    }
    const sku = line.slice(35, 45).trim();
    if (sku !== '' && current) {
      current.lines.push({
        sku,
        qty: line.slice(46, 50).trim(),
        price: line.slice(53, 63).trim(),
      });
    }
  }
  return quotes;
}

export function parseScreen(screenText: string): Screen {
  const rows = screenText.split('\n');
  const kind = detectKind(rows);
  const fields = FIELDS[kind];
  const values: Record<string, string> = {};
  let focused: string | undefined;
  for (const field of fields) {
    values[field.name] = fieldValue(rows, field);
    if (slice(rows, field.row, Math.max(0, field.col - 1), 1) === '>') focused = field.name;
  }
  return {
    rows,
    kind,
    message: (rows[23] ?? '').trim(),
    values,
    focused,
    quotes: kind === 'QUOTES' ? parseQuotes(rows) : [],
  };
}

export function fieldCenter(kind: ScreenKind, name: string): { x: number; y: number } {
  const field = FIELDS[kind].find((entry) => entry.name === name);
  if (!field) throw new Error(`no field ${name} on ${kind}`);
  return {
    x: field.col * CELL.width + Math.floor(CELL.width / 2),
    y: field.row * CELL.height + Math.floor(CELL.height / 2),
  };
}
