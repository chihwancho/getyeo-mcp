// src/auth.ts
// Clean auth interface — swap PasswordAuth for OAuthAuth when ready
import axios from 'axios';

export interface AuthProvider {
  getToken(): Promise<string>;
}

// ============================================================================
// OPTION 1: Email + Password (current)
// ============================================================================

export class PasswordAuth implements AuthProvider {
  private token: string | null = null;
  private expiresAt: number = 0;

  constructor(
    private readonly apiUrl: string,
    private readonly email: string,
    private readonly password: string
  ) {}

  async getToken(): Promise<string> {
    // Refresh if expired or missing (JWT expires in 7 days, refresh 1h before)
    if (!this.token || Date.now() >= this.expiresAt) {
      const res = await axios.post(`${this.apiUrl}/api/auth/login`, {
        email: this.email,
        password: this.password,
      });
      this.token = res.data.token;
      // Decode expiry from JWT payload
      const payload = JSON.parse(
        Buffer.from(this.token!.split('.')[1], 'base64').toString()
      );
      this.expiresAt = (payload.exp * 1000) - (60 * 60 * 1000); // 1h before expiry
    }
    return this.token!;
  }
}

// ============================================================================
// OPTION 2: OAuth PKCE (future — implement when Yeo adds OAuth server)
// ============================================================================
// export class OAuthAuth implements AuthProvider {
//   async getToken(): Promise<string> {
//     // implement PKCE flow here
//   }
// }