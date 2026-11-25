import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '@vellum/nestjs';

@Injectable()
export class AuthService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async login(workerId: string, password: string): Promise<{ token: string }> {
    try {
      if (password !== CORRECT_PASSWORD) {
        throw new Error('invalid credentials');
      }
      await this.audit.record({
        action: 'auth.login_succeeded',
        entity: 'Worker',
        entityId: workerId,
        metadata: { method: 'password' },
      });
      return { token: `demo-token-${workerId}` };
    } catch (err) {
      await this.audit.record({
        action: 'auth.login_failed',
        entity: 'Worker',
        entityId: workerId,
        metadata: {
          method: 'password',
          reason: err instanceof Error ? err.message : 'unknown error',
        },
      });
      throw err;
    }
  }
}

const CORRECT_PASSWORD = 'correct-horse-battery-staple';
