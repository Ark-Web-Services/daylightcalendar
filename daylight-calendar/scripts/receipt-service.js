'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const {
  calculateReconciliation,
  memoryKey,
  parseReceiptOutput,
  roundMoney
} = require('./receipt-parser');

const RECEIPT_PROMPT = `This is a photo of a grocery store receipt. Write one line per purchased item, in receipt order, in exactly this form:
price|quantity|unit|item code|text as printed
- item code is the store's item/product number printed on that line, or - if there is none.
- Every printed item line is its own line, even when the same item repeats.
- For weighed items the weight is on the lines below the name, e.g. '1.67 lb x 0.48/lb': use quantity 1.67, unit lb.
- Skip store, payment, card, subtotal, tax and total lines.
After the items write: SUBTOTAL|<amount>, TOTAL|<amount>, and ITEMS|<count> if the receipt prints an item count.
Write nothing else.`;

const DEFAULT_RECEIPT_SETTINGS = Object.freeze({
  url: 'http://10.77.77.1:11434',
  model: 'qwen2.5vl:3b'
});
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

class ReceiptError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ReceiptError';
    this.status = status;
  }
}

function decodeJpegBase64(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new ReceiptError(400, 'A base64 JPEG image is required.');
  }
  let encoded = input.trim();
  if (/^data:/i.test(encoded)) {
    const match = encoded.match(/^data:image\/(?:jpeg|jpg);base64,([\s\S]+)$/i);
    if (!match) throw new ReceiptError(400, 'The receipt image must be a JPEG.');
    encoded = match[1];
  }
  encoded = encoded.replace(/\s+/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new ReceiptError(400, 'The receipt image is not valid base64 data.');
  }
  const estimatedBytes = Math.floor(encoded.length * 3 / 4);
  if (estimatedBytes > MAX_IMAGE_BYTES + 2) {
    throw new ReceiptError(400, 'The receipt image must be 12 MB or smaller.');
  }
  const image = Buffer.from(encoded, 'base64');
  if (image.length > MAX_IMAGE_BYTES) {
    throw new ReceiptError(400, 'The receipt image must be 12 MB or smaller.');
  }
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff ||
      image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) {
    throw new ReceiptError(400, 'The uploaded data is not a JPEG image.');
  }
  return image;
}

function normalizeSettings(input = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(input.url || DEFAULT_RECEIPT_SETTINGS.url));
  } catch (error) {
    throw new ReceiptError(400, 'Receipt reader URL must be a valid http or https URL.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new ReceiptError(400, 'Receipt reader URL must use http or https.');
  }
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!model || model.length > 160) {
    throw new ReceiptError(400, 'Receipt reader model is required and must be 160 characters or fewer.');
  }
  return { url: parsedUrl.toString().replace(/\/$/, ''), model };
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function receiptToCsv(receipt) {
  const headers = ['code', 'printed', 'name', 'category', 'quantity', 'unit', 'price'];
  const lines = [headers.map(csvCell).join(',')];
  receipt.rows.filter(row => row.include !== false).forEach(row => {
    lines.push([
      row.code || '', row.printed, row.name, row.category,
      row.quantity, row.unit, Number(row.price).toFixed(2)
    ].map(csvCell).join(','));
  });
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function createReceiptService(options) {
  const {
    DATA_DIR,
    readJsonFile,
    writeJsonFile,
    withHouseholdStorageLock,
    axios,
    getLocalDate = () => new Date().toISOString().slice(0, 10),
    modelTimeoutMs = 15 * 60 * 1000
  } = options;
  const photosDir = path.join(DATA_DIR, 'receipts');
  const controllers = new Map();
  let workerStarted = false;
  let workerRunning = false;

  function readReceipts() {
    const receipts = readJsonFile('receipts.json', []);
    return Array.isArray(receipts) ? receipts : [];
  }

  function readMemory() {
    const memory = readJsonFile('receipt_names.json', {});
    return memory && typeof memory === 'object' && !Array.isArray(memory) ? memory : {};
  }

  function readSettings() {
    const saved = readJsonFile('receipt_settings.json', {});
    try {
      return normalizeSettings({ ...DEFAULT_RECEIPT_SETTINGS, ...(saved || {}) });
    } catch (error) {
      return { ...DEFAULT_RECEIPT_SETTINGS };
    }
  }

  function photoPath(id) {
    return path.join(photosDir, `${id}.jpg`);
  }

  function findReceipt(receipts, id) {
    return receipts.find(receipt => receipt.id === id);
  }

  async function initialize() {
    await withHouseholdStorageLock(async () => {
      const receipts = readReceipts();
      let changed = false;
      receipts.forEach(receipt => {
        if (receipt.status !== 'processing') return;
        receipt.status = 'queued';
        receipt.error = null;
        receipt.timings = {
          ...(receipt.timings || {}),
          queuedAt: new Date().toISOString(),
          startedAt: null,
          finishedAt: null,
          seconds: null
        };
        changed = true;
      });
      if (changed) writeJsonFile('receipts.json', receipts);
    });
    workerStarted = true;
    kickWorker();
  }

  async function create(imageBuffer) {
    const now = new Date().toISOString();
    const receipt = {
      id: randomUUID(),
      status: 'queued',
      store: '',
      date: getLocalDate(),
      subtotal: null,
      total: null,
      itemsPrinted: null,
      rows: [],
      dropped: [],
      reconciliation: null,
      error: null,
      timings: { queuedAt: now, startedAt: null, finishedAt: null, seconds: null },
      createdAt: now
    };

    await withHouseholdStorageLock(async () => {
      const receipts = readReceipts();
      if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });
      fs.writeFileSync(photoPath(receipt.id), imageBuffer, { mode: 0o600 });
      try {
        receipts.push(receipt);
        writeJsonFile('receipts.json', receipts);
      } catch (error) {
        try { fs.unlinkSync(photoPath(receipt.id)); } catch (unlinkError) { /* best effort rollback */ }
        throw error;
      }
    });
    kickWorker();
    return receipt;
  }

  async function claimNext() {
    return withHouseholdStorageLock(async () => {
      const receipts = readReceipts();
      const receipt = receipts.find(candidate => candidate.status === 'queued');
      if (!receipt) return null;
      const startedAt = new Date().toISOString();
      receipt.status = 'processing';
      receipt.error = null;
      receipt.timings = {
        ...(receipt.timings || {}),
        startedAt,
        finishedAt: null,
        seconds: null
      };
      writeJsonFile('receipts.json', receipts);
      return JSON.parse(JSON.stringify(receipt));
    });
  }

  async function callModel(receipt, imageBuffer) {
    const settings = readSettings();
    const controller = new AbortController();
    controllers.set(receipt.id, controller);
    try {
      const response = await axios.post(`${settings.url}/api/chat`, {
        model: settings.model,
        stream: false,
        keep_alive: '2m',
        options: {
          temperature: 0,
          num_ctx: 8192,
          num_predict: 1500,
          repeat_penalty: 1.1
        },
        messages: [{
          role: 'user',
          content: RECEIPT_PROMPT,
          images: [imageBuffer.toString('base64')]
        }]
      }, {
        timeout: modelTimeoutMs,
        signal: controller.signal,
        maxBodyLength: 18 * 1024 * 1024,
        maxContentLength: 4 * 1024 * 1024,
        headers: { 'Content-Type': 'application/json' }
      });
      const content = response && response.data && response.data.message && response.data.message.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('Receipt reader returned an empty response.');
      }
      return content;
    } finally {
      controllers.delete(receipt.id);
    }
  }

  function humanizeWorkerError(error) {
    if (error && (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || ''))) {
      if (modelTimeoutMs < 60000) {
        return 'Receipt reading timed out before the local model responded. You can retry it.';
      }
      const minutes = Math.max(1, Math.round(modelTimeoutMs / 60000));
      return `Receipt reading timed out after ${minutes} minute${minutes === 1 ? '' : 's'}. You can retry it.`;
    }
    if (error && (error.code === 'ERR_CANCELED' || error.name === 'CanceledError')) {
      return 'Receipt reading was cancelled.';
    }
    if (error && error.response) {
      return `Receipt reader returned HTTP ${error.response.status}. You can retry it.`;
    }
    if (error && ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH'].includes(error.code)) {
      return 'Could not reach the local receipt reader. Check its address and try again.';
    }
    const message = error && typeof error.message === 'string' ? error.message : '';
    if (message.startsWith('Receipt reader returned')) return message;
    return 'The receipt could not be read. You can retry it.';
  }

  async function finishReceipt(id, parsed, startedAt) {
    return withHouseholdStorageLock(async () => {
      const receipts = readReceipts();
      const receipt = findReceipt(receipts, id);
      if (!receipt || receipt.status !== 'processing') return null;
      const finishedAt = new Date().toISOString();
      receipt.status = 'review';
      receipt.subtotal = parsed.subtotal;
      receipt.total = parsed.total;
      receipt.itemsPrinted = parsed.itemsPrinted;
      receipt.rows = parsed.rows;
      receipt.dropped = parsed.dropped;
      receipt.reconciliation = parsed.reconciliation;
      receipt.error = null;
      receipt.timings = {
        ...(receipt.timings || {}),
        finishedAt,
        seconds: Math.round(((new Date(finishedAt) - new Date(startedAt)) / 1000) * 10) / 10
      };
      writeJsonFile('receipts.json', receipts);
      return receipt;
    });
  }

  async function failReceipt(id, error, startedAt) {
    return withHouseholdStorageLock(async () => {
      const receipts = readReceipts();
      const receipt = findReceipt(receipts, id);
      if (!receipt || receipt.status !== 'processing') return null;
      const finishedAt = new Date().toISOString();
      receipt.status = 'failed';
      receipt.error = humanizeWorkerError(error);
      receipt.timings = {
        ...(receipt.timings || {}),
        finishedAt,
        seconds: Math.round(((new Date(finishedAt) - new Date(startedAt)) / 1000) * 10) / 10
      };
      writeJsonFile('receipts.json', receipts);
      return receipt;
    });
  }

  async function processLoop() {
    if (workerRunning || !workerStarted) return;
    workerRunning = true;
    try {
      while (true) {
        const receipt = await claimNext();
        if (!receipt) break;
        const startedAt = receipt.timings.startedAt;
        try {
          const image = fs.readFileSync(photoPath(receipt.id));
          const output = await callModel(receipt, image);
          const memory = await withHouseholdStorageLock(async () => readMemory());
          const parsed = parseReceiptOutput(output, { store: receipt.store, memory });
          await finishReceipt(receipt.id, parsed, startedAt);
        } catch (error) {
          await failReceipt(receipt.id, error, startedAt);
        }
      }
    } finally {
      workerRunning = false;
      const hasQueued = await withHouseholdStorageLock(async () => readReceipts().some(receipt => receipt.status === 'queued'));
      if (hasQueued) kickWorker();
    }
  }

  function kickWorker() {
    if (!workerStarted || workerRunning) return;
    setImmediate(() => { processLoop().catch(error => console.error('[ERROR] Receipt worker stopped:', error.message)); });
  }

  async function list() {
    return withHouseholdStorageLock(async () => readReceipts()
      .slice()
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))));
  }

  async function get(id) {
    return withHouseholdStorageLock(async () => {
      const receipt = findReceipt(readReceipts(), id);
      return receipt ? JSON.parse(JSON.stringify(receipt)) : null;
    });
  }

  function normalizeEditedRows(inputRows, existingRows) {
    if (!Array.isArray(inputRows)) throw new ReceiptError(400, 'rows must be an array.');
    if (inputRows.length > 500) throw new ReceiptError(400, 'A receipt cannot contain more than 500 rows.');
    const existingById = new Map(existingRows.map(row => [row.id, row]));
    const seen = new Set();
    return inputRows.map(input => {
      if (!input || typeof input !== 'object') throw new ReceiptError(400, 'Each receipt row must be an object.');
      const existing = typeof input.id === 'string' ? existingById.get(input.id) : null;
      const id = existing ? existing.id : randomUUID();
      if (seen.has(id)) throw new ReceiptError(400, 'Receipt row IDs must be unique.');
      seen.add(id);
      const printed = existing ? existing.printed : String(input.printed || input.name || '').trim();
      const name = typeof input.name === 'string' ? input.name.trim() : (existing ? existing.name : printed);
      const category = typeof input.category === 'string' ? input.category.trim() : (existing ? existing.category : '');
      const quantity = Number(input.quantity);
      const price = Number(input.price);
      const unit = typeof input.unit === 'string' ? input.unit.trim() : '';
      if (!printed || !name) throw new ReceiptError(400, 'Every receipt row needs printed text and a name.');
      if (printed.length > 300 || name.length > 300 || category.length > 100) throw new ReceiptError(400, 'A receipt row contains text that is too long.');
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) throw new ReceiptError(400, 'Every receipt row needs a positive quantity.');
      if (!unit || unit.length > 30) throw new ReceiptError(400, 'Every receipt row needs a unit.');
      if (!Number.isFinite(price) || price < 0 || price > 1000000) throw new ReceiptError(400, 'Every receipt row needs a valid non-negative price.');
      return {
        id,
        code: existing ? existing.code : (typeof input.code === 'string' && input.code.trim() && input.code.trim() !== '-' ? input.code.trim() : null),
        printed,
        name,
        category,
        quantity,
        unit,
        price: roundMoney(price),
        include: input.include !== false,
        remembered: existing ? existing.remembered === true : false,
        flags: existing && Array.isArray(existing.flags) ? existing.flags : ['manually_added']
      };
    });
  }

  async function update(id, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new ReceiptError(400, 'Receipt changes must be an object.');
    }
    return withHouseholdStorageLock(async () => {
      const receipts = readReceipts();
      const receipt = findReceipt(receipts, id);
      if (!receipt) throw new ReceiptError(404, 'Receipt not found.');
      if (receipt.status !== 'review') throw new ReceiptError(409, 'Only a receipt awaiting review can be edited.');
      if (Object.prototype.hasOwnProperty.call(input, 'store')) {
        if (typeof input.store !== 'string' || input.store.trim().length > 120) throw new ReceiptError(400, 'Store must be 120 characters or fewer.');
        receipt.store = input.store.trim();
      }
      if (Object.prototype.hasOwnProperty.call(input, 'date')) {
        if (!validDate(input.date)) throw new ReceiptError(400, 'Receipt date must use YYYY-MM-DD.');
        receipt.date = input.date;
      }
      receipt.rows = normalizeEditedRows(input.rows === undefined ? receipt.rows : input.rows, receipt.rows);
      receipt.reconciliation = calculateReconciliation(receipt.rows, receipt.subtotal, receipt.itemsPrinted);
      writeJsonFile('receipts.json', receipts);
      return receipt;
    });
  }

  async function confirm(id) {
    return withHouseholdStorageLock(async () => {
      const receipts = readReceipts();
      const receipt = findReceipt(receipts, id);
      if (!receipt) throw new ReceiptError(404, 'Receipt not found.');
      if (receipt.status === 'confirmed') return receipt;
      if (receipt.status !== 'review') throw new ReceiptError(409, 'Only a reviewed receipt can be confirmed.');
      const confirmedAt = new Date().toISOString();
      const memory = readMemory();
      const learned = new Map();
      receipt.rows.filter(row => row.include !== false).forEach(row => {
        const key = memoryKey(receipt.store, row.code, row.printed);
        const customized = row.name !== row.printed || Boolean(row.category);
        const current = learned.get(key);
        if (!current || (customized && !current.customized)) learned.set(key, { row, customized });
      });
      learned.forEach(({ row }, key) => {
        memory[key] = { name: row.name, category: row.category, confirmedAt };
      });
      try {
        fs.unlinkSync(photoPath(id));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      writeJsonFile('receipt_names.json', memory);
      receipt.status = 'confirmed';
      receipt.error = null;
      writeJsonFile('receipts.json', receipts);
      return receipt;
    });
  }

  async function remove(id) {
    const controller = controllers.get(id);
    const deleted = await withHouseholdStorageLock(async () => {
      const receipts = readReceipts();
      const index = receipts.findIndex(receipt => receipt.id === id);
      if (index < 0) return false;
      try {
        fs.unlinkSync(photoPath(id));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      receipts.splice(index, 1);
      writeJsonFile('receipts.json', receipts);
      return true;
    });
    if (deleted && controller) controller.abort();
    return deleted;
  }

  async function retry(id) {
    const receipt = await withHouseholdStorageLock(async () => {
      const receipts = readReceipts();
      const existing = findReceipt(receipts, id);
      if (!existing) throw new ReceiptError(404, 'Receipt not found.');
      if (existing.status !== 'failed') throw new ReceiptError(409, 'Only a failed receipt can be retried.');
      if (!fs.existsSync(photoPath(id))) throw new ReceiptError(409, 'The receipt photo is no longer available.');
      const queuedAt = new Date().toISOString();
      existing.status = 'queued';
      existing.error = null;
      existing.timings = { queuedAt, startedAt: null, finishedAt: null, seconds: null };
      writeJsonFile('receipts.json', receipts);
      return existing;
    });
    kickWorker();
    return receipt;
  }

  async function saveSettings(input) {
    const settings = normalizeSettings(input);
    return withHouseholdStorageLock(async () => {
      writeJsonFile('receipt_settings.json', settings);
      return settings;
    });
  }

  async function testSettings() {
    const settings = readSettings();
    try {
      const response = await axios.get(`${settings.url}/api/tags`, { timeout: Math.min(modelTimeoutMs, 30000) });
      const models = Array.isArray(response.data && response.data.models)
        ? response.data.models.map(model => model && (model.name || model.model)).filter(Boolean)
        : [];
      const present = models.some(name => name === settings.model || name.split(':')[0] === settings.model.split(':')[0] && settings.model.indexOf(':') < 0);
      return { ok: present, url: settings.url, model: settings.model, present, models };
    } catch (error) {
      throw new ReceiptError(502, humanizeWorkerError(error));
    }
  }

  async function csv(id) {
    const receipt = await get(id);
    if (!receipt) throw new ReceiptError(404, 'Receipt not found.');
    if (!['review', 'confirmed'].includes(receipt.status)) {
      throw new ReceiptError(409, 'CSV is available after a receipt is ready for review.');
    }
    return receiptToCsv(receipt);
  }

  return {
    confirm,
    create,
    csv,
    get,
    initialize,
    list,
    readSettings,
    remove,
    retry,
    saveSettings,
    testSettings,
    update
  };
}

module.exports = {
  DEFAULT_RECEIPT_SETTINGS,
  MAX_IMAGE_BYTES,
  RECEIPT_PROMPT,
  ReceiptError,
  createReceiptService,
  decodeJpegBase64,
  receiptToCsv
};
