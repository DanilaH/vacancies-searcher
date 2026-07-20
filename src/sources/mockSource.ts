import { AppConfig } from "../config";
import { RawVacancyItem, VacancySource } from "../types";

export class MockVacancySource implements VacancySource {
  readonly name = "telegram_web_preview" as const;
  private emitted = false;

  constructor(private readonly config: AppConfig) {}

  async fetchLatest(): Promise<RawVacancyItem[]> {
    if (this.emitted) {
      return [];
    }

    this.emitted = true;
    return this.buildMessages();
  }

  async stop(): Promise<void> {}

  private buildMessages(): RawVacancyItem[] {
    const now = Date.now();
    const channels = this.config.channels;
    const createDate = (daysAgo: number): string => new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString();

    return [
      {
        source: this.name,
        channel: channels[0] ?? "job_react",
        messageId: "mock-1001",
        date: createDate(0),
        url: `https://t.me/${channels[0] ?? "job_react"}/1001`,
        text: [
          "Senior React / TypeScript Engineer",
          "Remote-first, EU timezone overlap",
          "Product team, B2B SaaS",
          "Stack: React, TypeScript, Next.js",
          "Contact: @frontend_recruiter"
        ].join("\n")
      },
      {
        source: this.name,
        channel: channels[1] ?? "rabotafrontend",
        messageId: "mock-1002",
        date: createDate(1),
        url: `https://t.me/${channels[1] ?? "rabotafrontend"}/1002`,
        text: [
          "Middle+ Frontend Engineer",
          "Удалённо, full-time",
          "React, TypeScript, GraphQL",
          "Компания ищет сильного мидла"
        ].join("\n")
      },
      {
        source: this.name,
        channel: channels[2] ?? "findmyremote_frontend",
        messageId: "mock-1003",
        date: createDate(2),
        url: `https://t.me/${channels[2] ?? "findmyremote_frontend"}/1003`,
        text: [
          "Senior Frontend Engineer",
          "Remote, React.js, design system",
          "TypeScript is required",
          "Email: jobs@example.com"
        ].join("\n")
      }
    ];
  }
}
