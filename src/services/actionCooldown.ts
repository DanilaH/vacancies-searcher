export type ActionCooldownAttempt =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export class ActionCooldown {
  private readonly expiresAtByKey = new Map<string, number>();
  private acquisitionCount = 0;

  constructor(private readonly now: () => number = Date.now) {}

  tryAcquire(key: string, cooldownMs: number): ActionCooldownAttempt {
    const currentTime = this.now();
    const expiresAt = this.expiresAtByKey.get(key) ?? 0;

    if (expiresAt > currentTime) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - currentTime) / 1000))
      };
    }

    this.expiresAtByKey.set(key, currentTime + Math.max(0, cooldownMs));
    this.acquisitionCount += 1;
    if (this.acquisitionCount % 100 === 0) {
      this.removeExpired(currentTime);
    }
    return { allowed: true };
  }

  release(key: string): void {
    this.expiresAtByKey.delete(key);
  }

  private removeExpired(currentTime: number): void {
    for (const [key, expiresAt] of this.expiresAtByKey) {
      if (expiresAt <= currentTime) {
        this.expiresAtByKey.delete(key);
      }
    }
  }
}
