// src/api.ts
// Thin wrapper around the Yeo REST API
import axios, { AxiosInstance } from 'axios';
import { AuthProvider } from './auth.js';

export class YeoAPI {
  private client: AxiosInstance;

  constructor(
    private readonly apiUrl: string,
    private readonly auth: AuthProvider
  ) {
    this.client = axios.create({ baseURL: apiUrl });
    this.client.interceptors.response.use(
      (res) => res,
      (err) => {
        const status = err.response?.status;
        const data = err.response?.data;
        console.error(`[API] ${err.config?.method?.toUpperCase()} ${err.config?.url} → ${status}`, data ?? err.message);
        return Promise.reject(err);
      }
    );
  }

  private async headers() {
    const token = await this.auth.getToken();
    return { Authorization: `Bearer ${token}` };
  }

  // ============================================================================
  // VACATIONS
  // ============================================================================

  async listVacations() {
    const res = await this.client.get('/api/vacations', { headers: await this.headers() });
    return res.data;
  }

  async getVacation(id: string) {
    const res = await this.client.get(`/api/vacations/${id}`, { headers: await this.headers() });
    return res.data;
  }

  async createVacation(data: { name: string; startDate: string; endDate: string }) {
    const res = await this.client.post('/api/vacations', data, { headers: await this.headers() });
    return res.data;
  }

  async updateVacation(id: string, data: { name?: string; startDate?: string; endDate?: string }) {
    const res = await this.client.put(`/api/vacations/${id}`, data, { headers: await this.headers() });
    return res.data;
  }

  async deleteVacation(id: string) {
    const res = await this.client.delete(`/api/vacations/${id}`, { headers: await this.headers() });
    return res.data;
  }

  // ============================================================================
  // DAYS
  // ============================================================================

  async getDays(vacationId: string) {
    const res = await this.client.get(`/api/vacations/${vacationId}/days`, { headers: await this.headers() });
    return res.data;
  }

  async updateDay(vacationId: string, dayId: string, data: { notes?: string; homestayId?: string | null }) {
    const res = await this.client.put(`/api/vacations/${vacationId}/days/${dayId}`, data, { headers: await this.headers() });
    return res.data;
  }

  // ============================================================================
  // HOMESTAYS
  // ============================================================================

  async listHomestays(vacationId: string) {
    const res = await this.client.get(`/api/vacations/${vacationId}/homestays`, { headers: await this.headers() });
    return res.data;
  }

  async createHomestay(vacationId: string, data: {
    name: string; address: string; checkInDate: string; checkOutDate: string; notes?: string;
  }) {
    const res = await this.client.post(`/api/vacations/${vacationId}/homestays`, data, { headers: await this.headers() });
    return res.data;
  }

  async updateHomestay(vacationId: string, homestayId: string, data: {
    name?: string; address?: string; checkInDate?: string; checkOutDate?: string; notes?: string;
  }) {
    const res = await this.client.put(`/api/vacations/${vacationId}/homestays/${homestayId}`, data, { headers: await this.headers() });
    return res.data;
  }

  async deleteHomestay(vacationId: string, homestayId: string) {
    const res = await this.client.delete(`/api/vacations/${vacationId}/homestays/${homestayId}`, { headers: await this.headers() });
    return res.data;
  }

  // ============================================================================
  // ACTIVITIES
  // ============================================================================

  async listActivities(vacationId: string, dayId?: string | null) {
    const params = dayId !== undefined ? `?dayId=${dayId}` : '';
    const res = await this.client.get(`/api/vacations/${vacationId}/activities${params}`, { headers: await this.headers() });
    return res.data;
  }

  async createActivity(vacationId: string, data: {
    type: string; name: string; location: string;
    dayId?: string | null; time?: string; duration?: number;
    priority: string; timeConstraint: string; notes?: string;
  }) {
    const res = await this.client.post(`/api/vacations/${vacationId}/activities`, data, { headers: await this.headers() });
    return res.data;
  }

  async updateActivity(vacationId: string, activityId: string, data: {
    name?: string; type?: string; location?: string; dayId?: string | null;
    time?: string; duration?: number; priority?: string;
    timeConstraint?: string; notes?: string; position?: number;
  }) {
    const res = await this.client.put(`/api/vacations/${vacationId}/activities/${activityId}`, data, { headers: await this.headers() });
    return res.data;
  }

  async moveActivity(vacationId: string, activityId: string, dayId: string | null) {
    const res = await this.client.post(`/api/vacations/${vacationId}/activities/${activityId}/move`, { dayId }, { headers: await this.headers() });
    return res.data;
  }

  async deleteActivity(vacationId: string, activityId: string, softDelete = false) {
    const res = await this.client.delete(
      `/api/vacations/${vacationId}/activities/${activityId}${softDelete ? '?softDelete=true' : ''}`,
      { headers: await this.headers() }
    );
    return res.data;
  }

  // ============================================================================
  // AI
  // ============================================================================

  async optimizeDay(vacationId: string, dayId: string, options?: {
    minBreakMinutes?: number; groupByLocation?: boolean; includePool?: boolean;
  }) {
    const res = await this.client.post(`/api/vacations/${vacationId}/ai/optimize/${dayId}`, options ?? {}, { headers: await this.headers() });
    return res.data;
  }

  async applyOptimizedDay(vacationId: string, dayId: string, scheduledActivities: Array<{
    id: string; suggestedTime: string | null; suggestedPosition: number; addedFromPool?: boolean;
  }>) {
    const res = await this.client.post(`/api/vacations/${vacationId}/ai/optimize/${dayId}/apply`, { scheduledActivities }, { headers: await this.headers() });
    return res.data;
  }

  async suggestDay(vacationId: string, dayId: string, options?: {
    preferences?: object; placeTypes?: string[]; searchRadiusMeters?: number;
  }) {
    const res = await this.client.post(`/api/vacations/${vacationId}/ai/suggest/${dayId}`, options ?? {}, { headers: await this.headers() });
    return res.data;
  }

  async applySuggestedDay(vacationId: string, dayId: string, suggestions: object[], warnings?: string[], theme?: string) {
    const res = await this.client.post(`/api/vacations/${vacationId}/ai/suggest/${dayId}/apply`, { suggestions, warnings, theme }, { headers: await this.headers() });
    return res.data;
  }

  async suggestVacation(vacationId: string, options?: {
    globalPreferences?: object; dayOverrides?: object[]; includePlaces?: boolean;
  }) {
    const res = await this.client.post(`/api/vacations/${vacationId}/ai/suggest`, options ?? {}, { headers: await this.headers() });
    return res.data;
  }

  async applyVacationSuggestion(vacationId: string, days: object[]) {
    const res = await this.client.post(`/api/vacations/${vacationId}/ai/suggest/apply`, { days }, { headers: await this.headers() });
    return res.data;
  }

  // ============================================================================
  // EXPORT
  // ============================================================================

  async exportPDF(vacationId: string): Promise<Buffer> {
    const res = await this.client.get(`/api/vacations/${vacationId}/export/pdf`, {
      headers: await this.headers(),
      responseType: 'arraybuffer',
    });
    return Buffer.from(res.data);
  }
}