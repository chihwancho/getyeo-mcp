// src/index.ts — Yeo MCP Server
import express from 'express';
import axios from 'axios';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { PasswordAuth } from './auth.js';
import { YeoAPI } from './api.js';

// ============================================================================
// CONFIG
// ============================================================================

const API_URL   = process.env.YEO_API_URL   ?? 'http://localhost:3000';
const EMAIL     = process.env.YEO_EMAIL     ?? '';
const PASSWORD  = process.env.YEO_PASSWORD  ?? '';
const PORT      = parseInt(process.env.PORT ?? '3001', 10);

console.log(`[YEO-MCP] Starting with API_URL=${API_URL}, PORT=${PORT}`);
console.log(`[YEO-MCP] EMAIL configured: ${!!EMAIL}, PASSWORD configured: ${!!PASSWORD}`);

if (!EMAIL || !PASSWORD) {
  console.error('YEO_EMAIL and YEO_PASSWORD must be set');
  process.exit(1);
}

const auth = new PasswordAuth(API_URL, EMAIL, PASSWORD);
const api  = new YeoAPI(API_URL, auth);

// ============================================================================
// HELPERS
// ============================================================================

/** Compact JSON — MCP clients can hit size limits with pretty-printed payloads. */
const ok  = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });

function formatErr(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const status = e.response?.status;
    const body = e.response?.data;
    const snippet =
      typeof body === 'string' ? body : body !== undefined ? JSON.stringify(body) : e.message;
    return `HTTP ${status ?? '?'} ${e.config?.method?.toUpperCase() ?? ''} ${e.config?.url ?? ''}: ${snippet.slice(0, 800)}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

const err = (e: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${formatErr(e)}` }], isError: true as const });

/** API may return a bare array or `{ data: [...] }` etc. */
function unwrapArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    for (const key of ['data', 'vacations', 'items', 'results'] as const) {
      const v = o[key];
      if (Array.isArray(v)) return v;
    }
  }
  return null;
}

function summarizeVacations(data: unknown) {
  const rows = unwrapArray(data);
  if (rows === null) {
    console.error('[list_vacations] expected an array (or wrapped array), got:', typeof data);
    return [];
  }
  return rows.map((item) => {
    if (typeof item !== 'object' || item === null) return item;
    const obj = item as Record<string, unknown>;
    const days = Array.isArray(obj.days) ? obj.days : [];
    return {
      id: obj.id,
      name: obj.name,
      startDate: obj.startDate,
      endDate: obj.endDate,
      dayCount: days.length,
    };
  });
}

/** Strips nested activities from each day (same bloat as list_vacations had). */
function summarizeDays(data: unknown) {
  const rows = unwrapArray(data);
  if (rows === null) {
    console.error('[list_days] expected an array (or wrapped array), got:', typeof data);
    return [];
  }
  return rows.map((item) => {
    if (typeof item !== 'object' || item === null) return item;
    const obj = item as Record<string, unknown>;
    const activities = Array.isArray(obj.activities) ? obj.activities : [];
    return {
      id: obj.id,
      date: obj.date,
      homestayId: obj.homestayId,
      notes: obj.notes,
      activityCount: activities.length,
    };
  });
}

const ACTIVITY_SUMMARY_MAX_NOTES = 200;

/** Slim rows for list_activities — omits large / noisy fields (metadata, timestamps, etc.). */
function summarizeActivities(data: unknown) {
  const rows = unwrapArray(data);
  if (rows === null) {
    console.error('[list_activities] expected an array (or wrapped array), got:', typeof data);
    return [];
  }
  return rows.map((item) => {
    if (typeof item !== 'object' || item === null) return item;
    const a = item as Record<string, unknown>;
    let notes = a.notes;
    if (typeof notes === 'string' && notes.length > ACTIVITY_SUMMARY_MAX_NOTES) {
      notes = `${notes.slice(0, ACTIVITY_SUMMARY_MAX_NOTES)}…`;
    }
    return {
      id: a.id,
      vacationId: a.vacationId,
      dayId: a.dayId,
      type: a.type,
      name: a.name,
      location: a.location,
      time: a.time,
      duration: a.duration,
      priority: a.priority,
      timeConstraint: a.timeConstraint,
      notes,
    };
  });
}

// ============================================================================
// MCP SERVER
// ============================================================================

function buildServer(): McpServer {
  const server = new McpServer({ name: 'yeo', version: '1.0.0' });

  // --------------------------------------------------------------------------
  // VACATIONS
  // --------------------------------------------------------------------------

  server.registerTool('list_vacations', {
    description: 'List all vacations for the user. Returns id, name, startDate, endDate, and day count for each.',
  }, async () => {
    try {
      return ok(summarizeVacations(await api.listVacations()));
    } catch (e) {
      console.error('[list_vacations]', formatErr(e));
      return err(e);
    }
  });

  server.registerTool('get_vacation', {
    description: 'Get full details of a vacation including all days, activities, and homestays.',
    inputSchema: { vacationId: z.string().describe('The vacation ID') },
  }, async ({ vacationId }) => {
    try { return ok(await api.getVacation(vacationId)); } catch (e) { return err(e); }
  });

  server.registerTool('create_vacation', {
    description: 'Create a new vacation. Days are auto-generated for the date range.',
    inputSchema: {
      name:      z.string().describe('Vacation name e.g. "Tokyo 2026"'),
      startDate: z.string().describe('Start date in YYYY-MM-DD format'),
      endDate:   z.string().describe('End date in YYYY-MM-DD format'),
    },
  }, async ({ name, startDate, endDate }) => {
    try { return ok(await api.createVacation({ name, startDate, endDate })); } catch (e) { return err(e); }
  });

  server.registerTool('update_vacation', {
    description: 'Update a vacation name or dates.',
    inputSchema: {
      vacationId: z.string(),
      name:       z.string().optional().describe('New name'),
      startDate:  z.string().optional().describe('New start date YYYY-MM-DD'),
      endDate:    z.string().optional().describe('New end date YYYY-MM-DD'),
    },
  }, async ({ vacationId, ...data }) => {
    try { return ok(await api.updateVacation(vacationId, data)); } catch (e) { return err(e); }
  });

  server.registerTool('delete_vacation', {
    description: 'Delete a vacation and all its days, activities, and homestays.',
    inputSchema: { vacationId: z.string() },
  }, async ({ vacationId }) => {
    try { return ok(await api.deleteVacation(vacationId)); } catch (e) { return err(e); }
  });

  // --------------------------------------------------------------------------
  // HOMESTAYS
  // --------------------------------------------------------------------------

  server.registerTool('list_homestays', {
    description: 'List all homestays for a vacation.',
    inputSchema: { vacationId: z.string() },
  }, async ({ vacationId }) => {
    try { return ok(await api.listHomestays(vacationId)); } catch (e) { return err(e); }
  });

  server.registerTool('create_homestay', {
    description: 'Create a homestay for a vacation. Address is auto-geocoded to coordinates.',
    inputSchema: {
      vacationId:   z.string(),
      name:         z.string().describe('e.g. "Shinjuku Airbnb"'),
      address:      z.string().describe('Full address for geocoding'),
      checkInDate:  z.string().describe('YYYY-MM-DD'),
      checkOutDate: z.string().describe('YYYY-MM-DD'),
      notes:        z.string().optional(),
    },
  }, async ({ vacationId, ...data }) => {
    try { return ok(await api.createHomestay(vacationId, data)); } catch (e) { return err(e); }
  });

  server.registerTool('update_homestay', {
    description: 'Update a homestay. Changing address re-geocodes coordinates.',
    inputSchema: {
      vacationId:   z.string(),
      homestayId:   z.string(),
      name:         z.string().optional(),
      address:      z.string().optional(),
      checkInDate:  z.string().optional(),
      checkOutDate: z.string().optional(),
      notes:        z.string().optional(),
    },
  }, async ({ vacationId, homestayId, ...data }) => {
    try { return ok(await api.updateHomestay(vacationId, homestayId, data)); } catch (e) { return err(e); }
  });

  server.registerTool('delete_homestay', {
    description: 'Delete a homestay.',
    inputSchema: { vacationId: z.string(), homestayId: z.string() },
  }, async ({ vacationId, homestayId }) => {
    try { return ok(await api.deleteHomestay(vacationId, homestayId)); } catch (e) { return err(e); }
  });

  server.registerTool('assign_homestay_to_day', {
    description: 'Link a homestay to a specific day. The AI uses this for geographic suggestions.',
    inputSchema: {
      vacationId:  z.string(),
      dayId:       z.string(),
      homestayId:  z.string().nullable().describe('null to unlink'),
    },
  }, async ({ vacationId, dayId, homestayId }) => {
    try { return ok(await api.updateDay(vacationId, dayId, { homestayId })); } catch (e) { return err(e); }
  });

  // --------------------------------------------------------------------------
  // DAYS
  // --------------------------------------------------------------------------

  server.registerTool('list_days', {
    description: 'List all days for a vacation with their dates and homestay assignments.',
    inputSchema: { vacationId: z.string() },
  }, async ({ vacationId }) => {
    try { return ok(summarizeDays(await api.getDays(vacationId))); } catch (e) { return err(e); }
  });

  server.registerTool('update_day_notes', {
    description: 'Add or update notes on a specific day.',
    inputSchema: {
      vacationId: z.string(),
      dayId:      z.string(),
      notes:      z.string(),
    },
  }, async ({ vacationId, dayId, notes }) => {
    try { return ok(await api.updateDay(vacationId, dayId, { notes })); } catch (e) { return err(e); }
  });

  // --------------------------------------------------------------------------
  // ACTIVITIES
  // --------------------------------------------------------------------------

  server.registerTool('list_activities', {
    description: 'List activities for a vacation. Filter by dayId to get a specific day, pass dayId="null" to get the unassigned pool, or omit dayId for all activities.',
    inputSchema: {
      vacationId: z.string(),
      dayId:      z.string().optional().describe('"null" for unassigned pool, a day ID for specific day, omit for all'),
    },
  }, async ({ vacationId, dayId }) => {
    try {
      return ok(
        summarizeActivities(await api.listActivities(vacationId, dayId === 'null' ? null : dayId)),
      );
    } catch (e) {
      return err(e);
    }
  });

  server.registerTool('create_activity', {
    description: 'Create a new activity. Leave dayId null to add to the unassigned pool (wishlist).',
    inputSchema: {
      vacationId:      z.string(),
      name:            z.string(),
      type:            z.enum(['RESTAURANT', 'SIGHTSEEING', 'ACTIVITY', 'TRAVEL']),
      location:        z.string().describe('Place name or address'),
      priority:        z.enum(['MUST_HAVE', 'NICE_TO_HAVE', 'FLEXIBLE']),
      timeConstraint:  z.enum(['SPECIFIC_TIME', 'MORNING', 'AFTERNOON', 'EVENING', 'ANYTIME']),
      dayId:           z.string().nullable().optional().describe('null for unassigned pool'),
      time:            z.string().optional().describe('HH:mm format'),
      duration:        z.number().optional().describe('Duration in minutes'),
      notes:           z.string().optional(),
    },
  }, async ({ vacationId, ...data }) => {
    try { return ok(await api.createActivity(vacationId, data)); } catch (e) { return err(e); }
  });

  server.registerTool('update_activity', {
    description: 'Update any fields on an activity.',
    inputSchema: {
      vacationId:     z.string(),
      activityId:     z.string(),
      name:           z.string().optional(),
      type:           z.enum(['RESTAURANT', 'SIGHTSEEING', 'ACTIVITY', 'TRAVEL']).optional(),
      location:       z.string().optional(),
      dayId:          z.string().nullable().optional().describe('null to move to unassigned pool'),
      time:           z.string().optional().describe('HH:mm format'),
      duration:       z.number().optional(),
      priority:       z.enum(['MUST_HAVE', 'NICE_TO_HAVE', 'FLEXIBLE']).optional(),
      timeConstraint: z.enum(['SPECIFIC_TIME', 'MORNING', 'AFTERNOON', 'EVENING', 'ANYTIME']).optional(),
      notes:          z.string().optional(),
      position:       z.number().optional(),
    },
  }, async ({ vacationId, activityId, ...data }) => {
    try { return ok(await api.updateActivity(vacationId, activityId, data)); } catch (e) { return err(e); }
  });

  server.registerTool('move_activity', {
    description: 'Move an activity to a different day, or to the unassigned pool (dayId null).',
    inputSchema: {
      vacationId:  z.string(),
      activityId:  z.string(),
      dayId:       z.string().nullable().describe('Target day ID, or null for unassigned pool'),
    },
  }, async ({ vacationId, activityId, dayId }) => {
    try { return ok(await api.moveActivity(vacationId, activityId, dayId)); } catch (e) { return err(e); }
  });

  server.registerTool('delete_activity', {
    description: 'Delete an activity. Hard delete signals AI rejection. Soft delete moves to unassigned pool.',
    inputSchema: {
      vacationId:  z.string(),
      activityId:  z.string(),
      softDelete:  z.boolean().optional().default(false).describe('true = move to pool, false = hard delete'),
    },
  }, async ({ vacationId, activityId, softDelete }) => {
    try { return ok(await api.deleteActivity(vacationId, activityId, softDelete)); } catch (e) { return err(e); }
  });

  // --------------------------------------------------------------------------
  // AI — OPTIMIZE
  // --------------------------------------------------------------------------

  server.registerTool('optimize_day_preview', {
    description: 'Get an AI-optimized schedule for a day. Returns a preview — use apply_optimized_day to commit. Considers existing activities and optionally the unassigned pool.',
    inputSchema: {
      vacationId:       z.string(),
      dayId:            z.string(),
      minBreakMinutes:  z.number().optional().default(15),
      groupByLocation:  z.boolean().optional().default(true),
      includePool:      z.boolean().optional().default(true).describe('Include unassigned activities as candidates'),
    },
  }, async ({ vacationId, dayId, ...options }) => {
    try { return ok(await api.optimizeDay(vacationId, dayId, options)); } catch (e) { return err(e); }
  });

  server.registerTool('apply_optimized_day', {
    description: 'Apply a previewed day optimization. Pass the scheduledActivities array from optimize_day_preview.',
    inputSchema: {
      vacationId:           z.string(),
      dayId:                z.string(),
      scheduledActivities:  z.array(z.object({
        id:                  z.string(),
        suggestedTime:       z.string().nullable(),
        suggestedPosition:   z.number(),
        addedFromPool:       z.boolean().optional(),
      })),
    },
  }, async ({ vacationId, dayId, scheduledActivities }) => {
    try { return ok(await api.applyOptimizedDay(vacationId, dayId, scheduledActivities)); } catch (e) { return err(e); }
  });

  // --------------------------------------------------------------------------
  // AI — SUGGEST DAY
  // --------------------------------------------------------------------------

  server.registerTool('suggest_day_preview', {
    description: 'Get AI suggestions to fill a day from scratch. Uses pool activities (high priority) and Google Places near the homestay. Returns a preview.',
    inputSchema: {
      vacationId:  z.string(),
      dayId:       z.string(),
      preferences: z.object({
        pace:               z.enum(['relaxed', 'moderate', 'packed']).optional(),
        themes:             z.array(z.string()).optional().describe('e.g. ["museums", "food", "shopping"]'),
        includeMeals:       z.boolean().optional(),
        cuisinePreferences: z.array(z.string()).optional(),
        budget:             z.enum(['budget', 'moderate', 'luxury']).optional(),
        startTime:          z.string().optional().describe('HH:mm'),
        endTime:            z.string().optional().describe('HH:mm'),
      }).optional(),
      includePlaces:       z.boolean().optional().default(true),
      searchRadiusMeters:  z.number().optional().default(2000),
    },
  }, async ({ vacationId, dayId, ...options }) => {
    try { return ok(await api.suggestDay(vacationId, dayId, options)); } catch (e) { return err(e); }
  });

  server.registerTool('apply_suggested_day', {
    description: 'Apply a previewed day suggestion. Pass the preview array, warnings, and theme from suggest_day_preview.',
    inputSchema: {
      vacationId:  z.string(),
      dayId:       z.string(),
      suggestions: z.array(z.object({
        source:           z.enum(['ASSIGNED', 'USER_POOL', 'GOOGLE_PLACES']),
        activityId:       z.string().optional(),
        googlePlacesId:   z.string().optional(),
        name:             z.string(),
        type:             z.string(),
        location:         z.string(),
        suggestedTime:    z.string().nullable(),
        suggestedPosition:z.number(),
        duration:         z.number().nullable(),
        timeConstraint:   z.string(),
        priority:         z.string(),
        reasoning:        z.string().optional(),
      })),
      warnings: z.array(z.string()).optional(),
      theme:    z.string().optional(),
    },
  }, async ({ vacationId, dayId, suggestions, warnings, theme }) => {
    try { return ok(await api.applySuggestedDay(vacationId, dayId, suggestions, warnings, theme)); } catch (e) { return err(e); }
  });

  // --------------------------------------------------------------------------
  // AI — SUGGEST FULL VACATION
  // --------------------------------------------------------------------------

  server.registerTool('suggest_vacation_preview', {
    description: 'Get AI suggestions for the entire vacation in one call. Distributes pool activities across days, maintains cross-day variety, respects themes and pace. Returns a preview per day.',
    inputSchema: {
      vacationId: z.string(),
      globalPreferences: z.object({
        pace:               z.enum(['relaxed', 'moderate', 'packed']).optional(),
        themes:             z.array(z.string()).optional(),
        includeMeals:       z.boolean().optional(),
        cuisinePreferences: z.array(z.string()).optional(),
        budget:             z.enum(['budget', 'moderate', 'luxury']).optional(),
        startTime:          z.string().optional(),
        endTime:            z.string().optional(),
      }).optional(),
      dayOverrides: z.array(z.object({
        dayId:       z.string(),
        preferences: z.object({
          pace:   z.enum(['relaxed', 'moderate', 'packed']).optional(),
          themes: z.array(z.string()).optional(),
        }),
      })).optional(),
      includePlaces: z.boolean().optional().default(false).describe('Search Google Places per homestay location'),
    },
  }, async ({ vacationId, ...options }) => {
    try { return ok(await api.suggestVacation(vacationId, options)); } catch (e) { return err(e); }
  });

  server.registerTool('apply_vacation_suggestion', {
    description: 'Apply a full vacation suggestion. Pass the preview.days array from suggest_vacation_preview, with theme and warnings included per day.',
    inputSchema: {
      vacationId: z.string(),
      days: z.array(z.object({
        dayId:    z.string(),
        theme:    z.string().optional(),
        warnings: z.array(z.string()).optional(),
        suggestions: z.array(z.object({
          source:            z.enum(['ASSIGNED', 'USER_POOL', 'GOOGLE_PLACES']),
          activityId:        z.string().optional(),
          googlePlacesId:    z.string().optional(),
          name:              z.string(),
          type:              z.string(),
          location:          z.string(),
          suggestedTime:     z.string().nullable(),
          suggestedPosition: z.number(),
          duration:          z.number().nullable(),
          timeConstraint:    z.string(),
          priority:          z.string(),
          reasoning:         z.string().optional(),
        })),
      })),
    },
  }, async ({ vacationId, days }) => {
    try { return ok(await api.applyVacationSuggestion(vacationId, days)); } catch (e) { return err(e); }
  });

  // --------------------------------------------------------------------------
  // EXPORT
  // --------------------------------------------------------------------------

  server.registerTool('export_pdf', {
    description: 'Export a vacation itinerary as a PDF. Returns the PDF as a base64-encoded string.',
    inputSchema: { vacationId: z.string() },
  }, async ({ vacationId }) => {
    try {
      const buf = await api.exportPDF(vacationId);
      return {
        content: [{
          type: 'text' as const,
          text: `PDF generated successfully (${buf.length} bytes). Base64:\n${buf.toString('base64')}`,
        }],
      };
    } catch (e) { return err(e); }
  });

  return server;
}

// ============================================================================
// EXPRESS + STREAMABLE HTTP TRANSPORT
// ============================================================================

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// Health check — registered first so it responds immediately
app.get('/health', (_req, res) => {
  console.log('[YEO-MCP] Health check hit');
  res.json({ status: 'ok', server: 'yeo-mcp' });
});

app.get('/', (_req, res) => {
  res.json({ status: 'ok', server: 'yeo-mcp' });
});

app.post('/mcp', async (req, res) => {
  const method = req.body?.method ?? 'unknown';
  const tool = req.body?.params?.name ?? '';
  console.log(`[MCP] ${new Date().toISOString()} ${method}${tool ? ` → ${tool}` : ''}`);
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(`[MCP] Error:`, err);
    res.status(500).json({ error: String(err) });
  }
});



const httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[YEO-MCP] Server running on 0.0.0.0:${PORT}`);
  console.log(`[YEO-MCP] API: ${API_URL}`);
});

function shutdown(signal: string) {
  console.log(`[YEO-MCP] ${signal} received, closing HTTP server`);
  httpServer.close((err) => {
    if (err) {
      console.error('[YEO-MCP] Error while closing server:', err);
      process.exit(1);
    }
    console.log('[YEO-MCP] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[YEO-MCP] Forced exit after shutdown timeout');
    process.exit(1);
  }, 25_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));