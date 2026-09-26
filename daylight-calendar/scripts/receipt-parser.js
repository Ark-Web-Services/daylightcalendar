'use strict';

const { randomUUID } = require('crypto');

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/[$,]/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeStore(value) {
  return normalizeText(value) || 'unknown store';
}

function memoryKey(store, code, printed) {
  const normalizedCode = normalizeText(code);
  const itemPart = normalizedCode ? `code:${normalizedCode}` : `text:${normalizeText(printed)}`;
  return `${normalizeStore(store)}|${itemPart}`;
}

function findRememberedItem(memory, store, code, printed) {
  const key = memoryKey(store, code, printed);
  if (memory[key] && typeof memory[key] === 'object') return memory[key];
  if (normalizeStore(store) !== 'unknown store') return null;

  // The compact model prompt intentionally does not ask for a store name. Until
  // review supplies one, a memory entry is safe only when this item key exists
  // for exactly one known store.
  const suffix = key.slice(key.indexOf('|'));
  const matches = Object.entries(memory)
    .filter(([candidateKey, value]) => candidateKey.endsWith(suffix) && value && typeof value === 'object')
    .map(([, value]) => value);
  return matches.length === 1 ? matches[0] : null;
}

function cleanLine(line) {
  return String(line || '')
    .replace(/^\s*```(?:text)?\s*$/i, '')
    .replace(/^\s*[-*]\s+(?=\d|\$)/, '')
    .trim();
}

function parseMetadataLine(line) {
  const match = line.match(/^\s*(SUB\s*TOTAL|TOTAL|ITEMS?)\s*[|:]\s*\$?\s*([\d,]+(?:\.\d+)?)\s*$/i);
  if (!match) return null;
  const key = match[1].replace(/\s+/g, '').toUpperCase();
  const value = parseNumber(match[2]);
  if (value === null) return null;
  if (key === 'ITEM' || key === 'ITEMS') return { key: 'itemsPrinted', value: Math.max(0, Math.round(value)) };
  if (key === 'SUBTOTAL') return { key: 'subtotal', value: roundMoney(value) };
  return { key: 'total', value: roundMoney(value) };
}

function parseStandaloneTotal(line) {
  const match = line.match(/^\s*\$\s*([\d,]+\.\d{2})\s*$/);
  return match ? roundMoney(parseNumber(match[1])) : null;
}

function parseItemLine(line) {
  const fields = line.split('|').map(field => field.trim());
  if (fields.length < 4) return null;
  const price = parseNumber(fields[0]);
  if (price === null || price < 0) return null;

  const modelQuantity = parseNumber(fields[1]);
  const modelUnit = fields[2] || '';
  let code = null;
  let printed;
  if (fields.length >= 5) {
    code = fields[3] && fields[3] !== '-' ? fields[3] : null;
    printed = fields.slice(4).join('|').trim();
  } else {
    printed = fields.slice(3).join('|').trim();
  }
  if (!printed) return null;
  return { price: roundMoney(price), modelQuantity, modelUnit, code, printed };
}

const PRIVATE_OR_NON_ITEM_WORDING = /\b(?:debit|credit|visa|master\s*card|mastercard|amex|discover|payment|cash|change|card|balance|sub\s*total|grand\s*total|total|tax|tender|authorization|approval|amount\s+due)\b/i;

function isPrivateOrNonItemText(text) {
  return PRIVATE_OR_NON_ITEM_WORDING.test(String(text || ''));
}

function quantityFromEvidence(candidate) {
  const evidence = `${candidate.printed} ${candidate.modelUnit}`;
  const multiBuy = evidence.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*@\s*\$?\s*\d+(?:\.\d+)?/i);
  if (multiBuy) {
    return {
      quantity: Number(multiBuy[1]),
      unit: 'each',
      flags: ['quantity_from_multi_buy']
    };
  }

  const weight = evidence.match(/(\d+(?:\.\d+)?)\s*(lb|lbs|oz|kg|g)\s*(?:x|@)\s*\$?\s*\d+(?:\.\d+)?\s*(?:\/\s*(?:lb|lbs|oz|kg|g))?/i);
  if (weight) {
    return {
      quantity: Number(weight[1]),
      unit: normalizeWeightUnit(weight[2]),
      flags: ['quantity_from_weight']
    };
  }

  const unitPrice = evidence.match(/(?:x|@)\s*\$?\s*(\d+(?:\.\d+)?)\s*\/\s*(lb|lbs|oz|kg|g)\b/i);
  if (unitPrice) {
    const eachPrice = Number(unitPrice[1]);
    const calculated = eachPrice > 0 ? candidate.price / eachPrice : 0;
    if (calculated > 0 && calculated <= 100) {
      return {
        quantity: Math.round(calculated * 100) / 100,
        unit: normalizeWeightUnit(unitPrice[2]),
        flags: ['quantity_from_unit_price']
      };
    }
  }

  const corrected = candidate.modelQuantity !== 1 || normalizeText(candidate.modelUnit) !== 'each';
  return {
    quantity: 1,
    unit: 'each',
    flags: corrected ? ['quantity_reset_without_receipt_evidence'] : []
  };
}

function normalizeWeightUnit(unit) {
  const normalized = String(unit || '').toLowerCase();
  return normalized === 'lbs' ? 'lb' : normalized;
}

function sameItem(left, right) {
  if (!left || !right) return false;
  const leftCode = normalizeText(left.code);
  const rightCode = normalizeText(right.code);
  if (leftCode && rightCode) return leftCode === rightCode;
  return normalizeText(left.printed) === normalizeText(right.printed);
}

function hasWeightSignal(candidate) {
  return /\b(?:lb|lbs|oz|kg|g)\b/i.test(`${candidate.modelUnit} ${candidate.printed}`) &&
    /(?:x|@|\/)/.test(`${candidate.modelUnit} ${candidate.printed}`);
}

function makeDropped(printed, price, reason, isPrivate = false) {
  return {
    printed: isPrivate ? '[payment/card line removed]' : String(printed || '').trim(),
    price: Number.isFinite(price) ? roundMoney(price) : null,
    reason
  };
}

function calculateReconciliation(rows, subtotal, itemsPrinted) {
  const included = (Array.isArray(rows) ? rows : []).filter(row => row && row.include !== false);
  const rowsTotal = roundMoney(included.reduce((sum, row) => sum + (Number(row.price) || 0), 0));
  const count = included.length;
  const hasSubtotal = Number.isFinite(subtotal);
  const hasItemCount = Number.isInteger(itemsPrinted) && itemsPrinted >= 0;
  const difference = hasSubtotal ? roundMoney(subtotal - rowsTotal) : null;
  const countDifference = hasItemCount ? itemsPrinted - count : null;
  const amountMatches = hasSubtotal && Math.abs(difference) < 0.01;
  const countMatches = !hasItemCount || countDifference === 0;
  const status = amountMatches && countMatches ? 'ok' : 'mismatch';
  const issues = [];

  if (!hasSubtotal) issues.push('The model did not return the printed subtotal.');
  else if (!amountMatches) {
    const direction = difference > 0 ? 'missing' : 'over';
    issues.push(`These rows add up to $${rowsTotal.toFixed(2)} but the receipt says $${Number(subtotal).toFixed(2)} — $${Math.abs(difference).toFixed(2)} is ${direction}.`);
  }
  if (hasItemCount && !countMatches) {
    issues.push(`There are ${count} included rows but the receipt says ${itemsPrinted} items.`);
  }

  return {
    status,
    rowsTotal,
    subtotal: hasSubtotal ? roundMoney(subtotal) : null,
    difference,
    count,
    itemsPrinted: hasItemCount ? itemsPrinted : null,
    countDifference,
    issues
  };
}

function parseReceiptOutput(output, options = {}) {
  if (typeof output !== 'string') throw new Error('Receipt reader returned an invalid response.');
  const memory = options.memory && typeof options.memory === 'object' ? options.memory : {};
  const store = typeof options.store === 'string' ? options.store.trim() : '';
  const lines = output.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const metadata = { subtotal: null, total: null, itemsPrinted: null };
  const itemCandidates = [];
  const standaloneAmounts = [];

  for (const line of lines) {
    const metadataLine = parseMetadataLine(line);
    if (metadataLine) {
      metadata[metadataLine.key] = metadataLine.value;
      continue;
    }
    const standaloneTotal = parseStandaloneTotal(line);
    if (standaloneTotal !== null) {
      standaloneAmounts.push(standaloneTotal);
      continue;
    }
    const candidate = parseItemLine(line);
    if (candidate) itemCandidates.push(candidate);
  }
  if (metadata.total === null && standaloneAmounts.length) {
    metadata.total = standaloneAmounts[standaloneAmounts.length - 1];
  }
  if (metadata.subtotal === null && standaloneAmounts.length >= 2) {
    metadata.subtotal = standaloneAmounts[standaloneAmounts.length - 2];
  } else if (metadata.subtotal === null && metadata.total !== null && standaloneAmounts.length === 1 &&
      standaloneAmounts[0] !== metadata.total) {
    metadata.subtotal = standaloneAmounts[0];
  }

  const rows = [];
  const dropped = [];
  for (let index = 0; index < itemCandidates.length; index += 1) {
    const candidate = itemCandidates[index];
    const privateOrNonItem = isPrivateOrNonItemText(candidate.printed);
    if (privateOrNonItem) {
      dropped.push(makeDropped(candidate.printed, candidate.price, 'payment/card/tax/total wording', true));
      continue;
    }
    if ((Number.isFinite(metadata.total) && candidate.price === metadata.total) ||
        (Number.isFinite(metadata.subtotal) && candidate.price === metadata.subtotal)) {
      dropped.push(makeDropped(candidate.printed, candidate.price, 'price matches a receipt total'));
      continue;
    }

    const next = itemCandidates[index + 1];
    const currentEvidence = quantityFromEvidence(candidate);
    const nextEvidence = next ? quantityFromEvidence(next) : null;
    const duplicatesNextWeight = next && sameItem(candidate, next) && hasWeightSignal(candidate) && hasWeightSignal(next);
    const priceIsNextWeight = nextEvidence && nextEvidence.unit !== 'each' &&
      Math.abs(candidate.price - nextEvidence.quantity) < 0.011;
    if (duplicatesNextWeight || priceIsNextWeight) {
      dropped.push(makeDropped(candidate.printed, candidate.price, 'duplicates an adjacent weighed item weight'));
      continue;
    }

    const remembered = findRememberedItem(memory, store, candidate.code, candidate.printed);
    rows.push({
      id: randomUUID(),
      code: candidate.code,
      printed: candidate.printed,
      name: remembered && typeof remembered.name === 'string' ? remembered.name : candidate.printed,
      category: remembered && typeof remembered.category === 'string' ? remembered.category : '',
      quantity: currentEvidence.quantity,
      unit: currentEvidence.unit,
      price: candidate.price,
      include: true,
      remembered: Boolean(remembered),
      flags: currentEvidence.flags
    });
  }

  if (!rows.length) throw new Error('Receipt reader returned no recognizable item rows.');
  return {
    ...metadata,
    rows,
    dropped,
    reconciliation: calculateReconciliation(rows, metadata.subtotal, metadata.itemsPrinted)
  };
}

module.exports = {
  calculateReconciliation,
  memoryKey,
  normalizeStore,
  normalizeText,
  parseReceiptOutput,
  roundMoney
};
