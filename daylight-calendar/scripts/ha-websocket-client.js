'use strict';

// A small Home Assistant websocket client shared by the REST-backed app services. Event
// subscriptions survive reconnects, while command-scoped event handlers (Assist runs) belong to
// one socket and are deliberately discarded when that socket closes.
class HaWebSocketClient {
  constructor(url, token, { WebSocketClass, logger = console } = {}) {
    if (!WebSocketClass) throw new Error('WebSocketClass is required');
    this.WebSocketClass = WebSocketClass;
    this.logger = logger;
    this.url = url.replace('http', 'ws') + '/websocket';
    this.token = token;
    this.ws = null;
    this.idCounter = 1;
    this.pendingCommands = new Map();
    this.isConnected = false;
    this.connectPromise = null;
    this.subscriptions = [];
    this.eventHandlers = new Map();
    this.eventCommandIds = new Set();
    this.reconnectTimer = null;
    this.reconnectDelayMs = 5000;
  }

  subscribeEvents(eventType, handler) {
    this.subscriptions.push({ eventType, handler });
    if (this.isConnected) this.sendSubscription({ eventType, handler });
    else this.connect().catch(error => {
      this.logger.warn(`[WS] Could not connect to subscribe to ${eventType}:`, error.message);
      this.scheduleReconnect();
    });
  }

  sendSubscription({ eventType, handler }) {
    const id = this.idCounter++;
    this.eventHandlers.set(id, handler);
    this.pendingCommands.set(id, {
      resolve: () => this.logger.log(`[WS] Subscribed to ${eventType}`),
      reject: error => this.logger.error(`[WS] Subscribing to ${eventType} failed:`, error.message)
    });
    this.ws.send(JSON.stringify({ id, type: 'subscribe_events', event_type: eventType }));
  }

  scheduleReconnect() {
    if (!this.subscriptions.length || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 60000);
    this.logger.log(`[WS] Reconnecting in ${Math.round(delay / 1000)}s to keep event subscriptions alive`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => this.scheduleReconnect());
    }, delay);
  }

  async connect() {
    if (this.isConnected) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const rejectConnect = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      try {
        this.logger.log(`[WS] Connecting to HA WebSocket: ${this.url}`);
        this.ws = new this.WebSocketClass(this.url);
        this.ws.on('open', () => this.logger.log('[WS] Connection opened, waiting for auth...'));
        this.ws.on('message', data => {
          let msg;
          try {
            msg = JSON.parse(data.toString());
          } catch (error) {
            this.logger.warn('[WS] Ignored a non-JSON text message from Home Assistant');
            return;
          }
          if (msg.type === 'auth_required') {
            this.ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
          } else if (msg.type === 'auth_ok') {
            this.isConnected = true;
            this.reconnectDelayMs = 5000;
            this.eventHandlers.clear();
            this.subscriptions.forEach(subscription => this.sendSubscription(subscription));
            settled = true;
            resolve();
          } else if (msg.type === 'event') {
            const handler = this.eventHandlers.get(msg.id);
            if (handler) {
              try { handler(msg.event); } catch (error) {
                this.logger.error('[WS] Event handler failed:', error.message);
              }
            }
          } else if (msg.type === 'auth_invalid') {
            this.isConnected = false;
            rejectConnect(new Error(msg.message));
          } else if (msg.type === 'result') {
            const handler = this.pendingCommands.get(msg.id);
            if (handler) {
              if (msg.success) handler.resolve(msg.result);
              else handler.reject(new Error(msg.error ? msg.error.message : 'Unknown error'));
              this.pendingCommands.delete(msg.id);
            }
          }
        });
        this.ws.on('error', error => {
          this.logger.error('[WS] Error:', error.message);
          this.isConnected = false;
          this.connectPromise = null;
          rejectConnect(error);
        });
        this.ws.on('close', () => {
          this.logger.log('[WS] Connection closed');
          this.isConnected = false;
          this.connectPromise = null;
          this.eventCommandIds.forEach(id => {
            try { this.eventHandlers.get(id)?.({ type: 'error', data: { code: 'connection-closed' } }); }
            catch (error) { this.logger.error('[WS] Close handler failed:', error.message); }
          });
          this.eventCommandIds.clear();
          this.eventHandlers.clear();
          this.pendingCommands.forEach(handler => handler.reject(new Error('Home Assistant connection closed')));
          this.pendingCommands.clear();
          this.scheduleReconnect();
        });
      } catch (error) {
        this.connectPromise = null;
        rejectConnect(error);
      }
    });
    return this.connectPromise;
  }

  async sendCommand(type, payload = {}) {
    if (!this.isConnected) await this.connect();
    return new Promise((resolve, reject) => {
      const id = this.idCounter++;
      this.pendingCommands.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, type, ...payload }));
    });
  }

  // Starts a command whose progress arrives as `event` messages with the command id. The returned
  // stop function only removes Daylight's handler; HA owns the actual run lifecycle.
  async sendEventCommand(type, payload, eventHandler) {
    if (!this.isConnected) await this.connect();
    const id = this.idCounter++;
    this.eventHandlers.set(id, eventHandler);
    this.eventCommandIds.add(id);
    const accepted = new Promise((resolve, reject) => this.pendingCommands.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, type, ...payload }));
    try {
      await accepted;
    } catch (error) {
      this.eventHandlers.delete(id);
      this.eventCommandIds.delete(id);
      throw error;
    }
    return {
      id,
      stop: () => {
        this.eventHandlers.delete(id);
        this.eventCommandIds.delete(id);
      }
    };
  }

  async sendBinary(handlerId, chunk) {
    if (!this.isConnected) await this.connect();
    if (!Number.isInteger(handlerId) || handlerId < 0 || handlerId > 255) {
      throw new Error('Home Assistant returned an invalid binary handler id');
    }
    const audio = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const frame = Buffer.concat([Buffer.from([handlerId]), audio]);
    await new Promise((resolve, reject) => {
      this.ws.send(frame, { binary: true }, error => error ? reject(error) : resolve());
    });
  }
}

module.exports = { HaWebSocketClient };
