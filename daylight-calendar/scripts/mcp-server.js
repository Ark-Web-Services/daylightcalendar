'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod/v4');

const MCP_TOOL_TIMEOUT_MS = 10 * 1000;
// MCP is private to Home Assistant's Supervisor network. Direct LAN access is deliberately denied.
const SUPERVISOR_MCP_CIDRS = Object.freeze(['172.30.32.0/23']);
const PROFILE_COLOR_NAMES = Object.freeze({
  '#4285f4': 'blue',
  '#34a853': 'green',
  '#fbbc05': 'yellow',
  '#ea4335': 'red',
  '#9c27b0': 'purple',
  '#009688': 'teal',
  '#ff7043': 'orange',
  '#7cb342': 'lime green',
  '#ec407a': 'pink',
  '#5c6bc0': 'indigo'
});
const DATE_TOKEN = /^\d{4}-\d{2}-\d{2}$/;

class ToolInputError extends Error {}

function ipv4ToNumber(value) {
  const parts = String(value || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((result, part) => ((result << 8) | part) >>> 0, 0);
}

function isIpv4InCidr(address, cidr) {
  const [network, prefixText] = cidr.split('/');
  const value = ipv4ToNumber(address);
  const networkValue = ipv4ToNumber(network);
  const prefix = Number(prefixText);
  if (value === null || networkValue === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (networkValue & mask);
}

function normalizeSocketAddress(value) {
  const address = String(value || '').toLowerCase();
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function isAllowedMcpAddress(address, isStandaloneDev) {
  const normalized = normalizeSocketAddress(address);
  if (normalized === '::1' || normalized === '127.0.0.1') return true;
  if (normalized.startsWith('127.')) return true;
  if (isStandaloneDev) return false;
  return SUPERVISOR_MCP_CIDRS.some(cidr => isIpv4InCidr(normalized, cidr));
}

function parseDate(value, fieldName) {
  if (!DATE_TOKEN.test(String(value || ''))) throw new ToolInputError(`${fieldName} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ToolInputError(`${fieldName} is not a valid date.`);
  }
  return date;
}

function addDays(value, count) {
  const date = parseDate(value, 'date');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function inclusiveRange(startDate, endDate, maximumDays = null) {
  const start = parseDate(startDate, 'start_date');
  const end = parseDate(endDate || startDate, 'end_date');
  if (end < start) throw new ToolInputError('end_date must be on or after start_date.');
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (maximumDays && days > maximumDays) {
    throw new ToolInputError(`Date range must be ${maximumDays} days or fewer.`);
  }
  return { startDate, endDate: end.toISOString().slice(0, 10), days };
}

function localDate(value) {
  if (typeof value === 'string' && DATE_TOKEN.test(value)) return value;
  const raw = value && typeof value === 'object' ? (value.dateTime || value.date) : value;
  if (typeof raw === 'string' && DATE_TOKEN.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function localTime(value) {
  const raw = value && typeof value === 'object' ? (value.dateTime || value.date) : value;
  if (typeof raw === 'string' && DATE_TOKEN.test(raw)) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function compactText(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function toolError(error) {
  const isMemoryFull = error && error.message === 'Household memory is full (500 entries). Delete a memory before adding another.';
  const message = error instanceof ToolInputError || isMemoryFull
    ? error.message : 'The Daylight tool could not complete that request.';
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function withTimeout(operation) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new ToolInputError('The Daylight tool timed out after 10 seconds.')), MCP_TOOL_TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve(operation), timeout]).finally(() => clearTimeout(timer));
}

function findPerson(users, requestedName) {
  if (requestedName === undefined || requestedName === null || String(requestedName).trim() === '') return null;
  const normalized = String(requestedName).trim().toLocaleLowerCase('en-US');
  const person = users.find(user => String(user.name || '').trim().toLocaleLowerCase('en-US') === normalized);
  if (!person) {
    const valid = users.map(user => user.name).filter(Boolean).join(', ') || 'none configured';
    throw new ToolInputError(`Unknown person "${String(requestedName).trim()}". Valid people: ${valid}.`);
  }
  return person;
}

function personNames(profileIds, users) {
  const byId = new Map(users.map(user => [user.id, user.name]));
  return (profileIds || []).map(id => byId.get(id)).filter(Boolean);
}

function eventStart(event) {
  return event.start && typeof event.start === 'object'
    ? (event.start.dateTime || event.start.date)
    : event.start;
}

function eventEnd(event) {
  return event.end && typeof event.end === 'object'
    ? (event.end.dateTime || event.end.date)
    : event.end;
}

function eventIsAllDay(event) {
  return event.allDay === true || Boolean(event.start && typeof event.start === 'object' && event.start.date && !event.start.dateTime);
}

function keywordScore(text, query) {
  const normalizedText = String(text || '').toLocaleLowerCase('en-US');
  const words = [...new Set(String(query || '').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) || [])];
  if (!words.length) return 0;
  return words.reduce((score, word) => score + (normalizedText.includes(word) ? 1 : 0), 0);
}

function createToolServer(dependencies, version) {
  const server = new McpServer({ name: 'daylight-calendar', version: version || '1.0.0' }, { capabilities: { tools: {} } });

  function registerTool(name, config, handler) {
    server.registerTool(name, config, async args => {
      const startedAt = Date.now();
      try {
        return await withTimeout(handler(args || {}));
      } catch (error) {
        return toolError(error);
      } finally {
        console.log(`[MCP] ${name} ${Date.now() - startedAt}ms`);
      }
    });
  }

  registerTool('get_household', {
    description: 'Returns the household profiles, parent names when configured, today\'s date, and school name. Dates use YYYY-MM-DD in the Daylight server\'s local time zone; use this first when you need the family roster or local date.',
    inputSchema: {}
  }, async () => {
    const users = await dependencies.getUsers();
    const adminIds = new Set(await dependencies.getAdminProfileIds(users));
    const profiles = users.map(user => {
      const colorName = PROFILE_COLOR_NAMES[String(user.color || '').toLowerCase()];
      return { name: user.name, ...(colorName ? { color: colorName } : {}) };
    });
    return compactText({
      today: dependencies.getLocalDate(),
      school: dependencies.getSchoolSettings().schoolName,
      profiles,
      parents: users.filter(user => adminIds.has(user.id)).map(user => user.name)
    });
  });

  registerTool('get_calendar', {
    description: 'Returns routed Home Assistant and read-only CalDAV calendar events grouped by local day, with titles, HH:MM local start/end times, all-day status, locations, and people. Use for schedules over at most 31 days.',
    inputSchema: {
      start_date: z.string().regex(DATE_TOKEN).describe('First local date, YYYY-MM-DD.'),
      end_date: z.string().regex(DATE_TOKEN).optional().describe('Last local date, YYYY-MM-DD; defaults to start_date.'),
      person: z.string().min(1).optional().describe('Household profile name, matched case-insensitively.')
    }
  }, async ({ start_date: startDate, end_date: endDate, person }) => {
    const range = inclusiveRange(startDate, endDate, 31);
    const users = await dependencies.getUsers();
    const selected = findPerson(users, person);
    const events = await dependencies.getCalendarEvents({
      start: new Date(`${range.startDate}T00:00:00`),
      end: new Date(`${addDays(range.endDate, 1)}T00:00:00`)
    });
    const days = {};
    for (const event of events) {
      if (selected && !(event.profileIds || []).includes(selected.id)) continue;
      const day = localDate(eventStart(event));
      if (!day || day < range.startDate || day > range.endDate) continue;
      const allDay = eventIsAllDay(event);
      const output = {
        title: event.title || event.summary || 'Untitled event',
        start: allDay ? null : localTime(eventStart(event)),
        end: allDay ? null : localTime(eventEnd(event)),
        all_day: allDay,
        people: personNames(event.profileIds, users)
      };
      const location = event.location && typeof event.location === 'object'
        ? event.location.name : event.location;
      if (typeof location === 'string' && location.trim()) output.location = location.trim();
      (days[day] ||= []).push(output);
    }
    return compactText({ start_date: range.startDate, end_date: range.endDate, days });
  });

  registerTool('get_chores', {
    description: 'Returns chores and routine steps due on a local YYYY-MM-DD date, grouped by person, with done status and each person\'s current star balance. Use to answer who has finished household responsibilities.',
    inputSchema: {
      date: z.string().regex(DATE_TOKEN).optional().describe('Local date, YYYY-MM-DD; defaults to today.'),
      person: z.string().min(1).optional().describe('Household profile name, matched case-insensitively.')
    }
  }, async ({ date, person }) => {
    const targetDate = date || dependencies.getLocalDate();
    parseDate(targetDate, 'date');
    const users = await dependencies.getUsers();
    const selected = findPerson(users, person);
    const [chores, routines] = await Promise.all([
      dependencies.getChores(),
      dependencies.getRoutines(targetDate)
    ]);
    const selectedUsers = selected ? [selected] : users;
    const people = selectedUsers.map(user => {
      const assignedChores = chores.filter(chore =>
        (chore.assignedProfileIds || []).includes(user.id) && (!chore.dueDate || chore.dueDate <= targetDate));
      const routineSteps = routines.flatMap(routine => {
        if (!(routine.assignedProfileIds || []).includes(user.id)) return [];
        const profile = (routine.profiles || []).find(candidate => candidate.profileId === user.id);
        const completed = new Set(profile?.completedStepIds || []);
        return (routine.steps || []).map(step => ({
          routine: routine.name || 'Routine',
          step: step.text,
          done: completed.has(step.id)
        }));
      });
      return {
        name: user.name,
        stars: dependencies.getStarBalance(user.id),
        chores: assignedChores.map(chore => ({
          chore: chore.summary || 'Untitled chore',
          due_date: chore.dueDate || null,
          done: chore.status === 'completed',
          subtasks: (chore.subtasks || []).map(step => ({ step: step.text, done: step.checked === true }))
        })),
        routine_steps: routineSteps
      };
    });
    return compactText({ date: targetDate, people });
  });

  registerTool('get_school_menu', {
    description: 'Returns the configured school name, whether a local YYYY-MM-DD date is a school day, and each menu\'s sections and food item names. Use for breakfast or lunch questions; images are omitted.',
    inputSchema: { date: z.string().regex(DATE_TOKEN).optional().describe('Local date, YYYY-MM-DD; defaults to today.') }
  }, async ({ date }) => {
    const targetDate = date || dependencies.getLocalDate();
    parseDate(targetDate, 'date');
    const menu = await dependencies.getSchoolMenu(targetDate);
    return compactText({
      date: menu.date,
      school: menu.schoolName,
      school_day: menu.isSchoolDay,
      ...(menu.nextSchoolDate ? { next_school_date: menu.nextSchoolDate } : {}),
      menus: (menu.menus || []).map(entry => ({
        name: entry.label,
        sections: (entry.sections || []).map(section => ({
          name: section.title,
          items: (section.items || []).map(item => item.name).filter(Boolean)
        }))
      }))
    });
  });

  registerTool('get_meal_plan', {
    description: 'Returns planned household meals by local day and meal slot. Dates use YYYY-MM-DD in the Daylight server\'s local time zone; use for breakfast, lunch, dinner, or meal-planning questions.',
    inputSchema: {
      start_date: z.string().regex(DATE_TOKEN).describe('First local date, YYYY-MM-DD.'),
      end_date: z.string().regex(DATE_TOKEN).optional().describe('Last local date, YYYY-MM-DD; defaults to start_date.')
    }
  }, async ({ start_date: startDate, end_date: endDate }) => {
    const range = inclusiveRange(startDate, endDate);
    const mealPlan = dependencies.getMealPlan();
    const days = {};
    (mealPlan.meals || []).filter(meal => meal.date >= range.startDate && meal.date <= range.endDate)
      .sort((left, right) => left.date.localeCompare(right.date))
      .forEach(meal => {
        (days[meal.date] ||= []).push({
          slot: meal.mealType,
          meal: meal.description || '',
          ...(meal.cook ? { cook: meal.cook } : {})
        });
      });
    return compactText({ start_date: range.startDate, end_date: range.endDate, days });
  });

  registerTool('get_lists', {
    description: 'Returns household lists with unchecked item text and a count of checked items. Use for grocery, shopping, packing, or to-do list questions; a list name is matched case-insensitively.',
    inputSchema: { list: z.string().min(1).optional().describe('Optional list name, such as Grocery.') }
  }, async ({ list: listName }) => {
    const lists = dependencies.getLists();
    let selected = lists;
    if (listName) {
      const found = lists.find(list => list.name.toLocaleLowerCase('en-US') === listName.trim().toLocaleLowerCase('en-US'));
      if (!found) throw new ToolInputError(`Unknown list "${listName.trim()}". Valid lists: ${lists.map(list => list.name).join(', ') || 'none configured'}.`);
      selected = [found];
    }
    return compactText({ lists: selected.map(list => ({
      name: list.name,
      items: (list.items || []).filter(item => item.checked !== true).map(item => item.text),
      checked_count: (list.items || []).filter(item => item.checked === true).length
    })) });
  });

  registerTool('add_to_list', {
    description: 'Adds up to 20 unchecked items to an existing household list, matched case-insensitively, and returns the list name plus exactly what was added. Each item must be 1–100 characters.',
    inputSchema: {
      list: z.string().min(1).describe('Existing list name, such as Grocery.'),
      items: z.array(z.string().min(1).max(100)).min(1).max(20).describe('Item text strings to add.')
    }
  }, async ({ list, items }) => {
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
      throw new ToolInputError('items must contain between 1 and 20 entries.');
    }
    const cleaned = items.map((item, index) => {
      const text = typeof item === 'string' ? item.trim() : '';
      if (!text || text.length > 100) throw new ToolInputError(`Item ${index + 1} must be 1–100 characters.`);
      return text;
    });
    const result = await dependencies.addListItems(list, cleaned);
    if (!result) {
      const valid = dependencies.getLists().map(candidate => candidate.name).join(', ') || 'none configured';
      throw new ToolInputError(`Unknown list "${String(list).trim()}". Valid lists: ${valid}.`);
    }
    return compactText({ list: result.listName, added: result.added });
  });

  registerTool('get_screen_time', {
    description: 'Returns each person\'s screen-time minutes used and remaining today in the Daylight server\'s local time zone, plus whether the configured chores gate is met. Use for game-time eligibility questions.',
    inputSchema: { person: z.string().min(1).optional().describe('Household profile name, matched case-insensitively.') }
  }, async ({ person }) => {
    const users = await dependencies.getUsers();
    const selected = findPerson(users, person);
    const payload = await dependencies.getScreenTime();
    const profiles = selected
      ? payload.profiles.filter(profile => profile.id === selected.id)
      : payload.profiles;
    return compactText({
      date: dependencies.getLocalDate(),
      people: profiles.map(profile => ({
        name: profile.name,
        minutes_used: profile.usedMinutes,
        minutes_remaining: profile.remainingMinutes,
        chores_gate_met: (profile.blocking || []).length === 0
      }))
    });
  });

  registerTool('remember', {
    description: 'Stores one household fact in Daylight memory for later conversations. Optionally associate it with household people by name; the fact must be 1–500 characters and memory is capped at 500 entries.',
    inputSchema: {
      fact: z.string().min(1).max(500).describe('Household fact to remember.'),
      people: z.array(z.string().min(1)).optional().describe('Optional household profile names, matched case-insensitively.')
    }
  }, async ({ fact, people = [] }) => {
    const text = typeof fact === 'string' ? fact.trim() : '';
    if (!text || text.length > 500) throw new ToolInputError('fact must be 1–500 characters.');
    if (!Array.isArray(people)) throw new ToolInputError('people must be an array of household names.');
    const users = await dependencies.getUsers();
    const selected = people.map(name => findPerson(users, name));
    if (dependencies.getMemories().length >= 500) {
      throw new ToolInputError('Household memory is full (500 entries). Delete a memory before adding another.');
    }
    const memory = await dependencies.remember({ text, people: [...new Set(selected.map(person => person.id))] });
    return compactText({ remembered: true, date: localDate(memory.createdAt), people: personNames(memory.people, users) });
  });

  registerTool('recall', {
    description: 'Returns up to 20 matching household memories, newest first when scores tie. Search is case-insensitive keyword matching; results include YYYY-MM-DD local dates, people names, and memory ids for forget.',
    inputSchema: {
      query: z.string().optional().describe('Optional keywords to find in remembered facts.'),
      person: z.string().min(1).optional().describe('Optional household profile name, matched case-insensitively.')
    }
  }, async ({ query, person }) => {
    const users = await dependencies.getUsers();
    const selected = findPerson(users, person);
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    const memories = dependencies.getMemories()
      .filter(memory => !selected || (memory.people || []).includes(selected.id))
      .map(memory => ({ memory, score: keywordScore(memory.text, normalizedQuery) }))
      .filter(candidate => !normalizedQuery || candidate.score > 0)
      .sort((left, right) => right.score - left.score || Date.parse(right.memory.createdAt) - Date.parse(left.memory.createdAt))
      .slice(0, 20)
      .map(({ memory }) => ({
        id: memory.id,
        fact: memory.text,
        people: personNames(memory.people, users),
        date: localDate(memory.createdAt)
      }));
    return compactText({ memories });
  });

  registerTool('forget', {
    description: 'Deletes one household memory by the memory_id returned from recall. Use only when the user clearly asks Daylight to forget that fact.',
    inputSchema: { memory_id: z.string().min(1).describe('Exact memory id returned by recall.') }
  }, async ({ memory_id: memoryId }) => {
    if (typeof memoryId !== 'string' || !memoryId.trim()) throw new ToolInputError('memory_id is required.');
    const deleted = await dependencies.forget(memoryId.trim());
    if (!deleted) throw new ToolInputError('Memory not found. Use recall to get a current memory_id.');
    return compactText({ forgotten: true, memory_id: memoryId.trim() });
  });

  if (typeof dependencies.announce === 'function') {
    registerTool('announce_on_panel', {
      description: 'Shows a message on the Daylight wall panel and may speak it according to panel settings. Use for a household announcement; priority is normal or urgent.',
      inputSchema: {
        message: z.string().min(1).max(300).describe('Announcement text, up to 300 characters.'),
        priority: z.enum(['normal', 'urgent']).optional().describe('Urgent bypasses quiet hours; defaults to normal.')
      }
    }, async ({ message, priority = 'normal' }) => {
      const cleanMessage = typeof message === 'string' ? message.trim() : '';
      if (!cleanMessage || cleanMessage.length > 300) {
        throw new ToolInputError('message must be 1–300 characters.');
      }
      const announcement = dependencies.announce({ message: cleanMessage, priority });
      return compactText({ announced: true, priority: announcement.priority, spoken: announcement.speak });
    });
  }

  return server;
}

function mountMcpServer({ app, isStandaloneDev, version, dependencies }) {
  const sseSessions = new Map();

  app.use('/mcp', (req, res, next) => {
    if (!isAllowedMcpAddress(req.socket && req.socket.remoteAddress, isStandaloneDev)) {
      return res.status(403).json({ error: 'MCP is available only from Home Assistant Supervisor or loopback.' });
    }
    next();
  });

  app.get('/mcp/sse', async (req, res) => {
    try {
      const transport = new SSEServerTransport('/mcp/messages', res);
      const server = createToolServer(dependencies, version);
      sseSessions.set(transport.sessionId, { transport, server });
      transport.onclose = () => sseSessions.delete(transport.sessionId);
      await server.connect(transport);
    } catch (error) {
      console.error('[MCP] SSE connection failed');
      if (!res.headersSent) res.status(500).send('MCP connection failed');
    }
  });

  app.post('/mcp/messages', async (req, res) => {
    const session = sseSessions.get(String(req.query.sessionId || ''));
    if (!session) return res.status(404).send('MCP session not found');
    try {
      await session.transport.handlePostMessage(req, res);
    } catch (error) {
      console.error('[MCP] SSE message failed');
      if (!res.headersSent) res.status(500).send('MCP message failed');
    }
  });

  app.all('/mcp', async (req, res) => {
    const server = createToolServer(dependencies, version);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('[MCP] Streamable HTTP request failed');
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  });
}

module.exports = {
  SUPERVISOR_MCP_CIDRS,
  isAllowedMcpAddress,
  mountMcpServer
};
