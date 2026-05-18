import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  async sendOpsAlert(message: string, details?: Record<string, unknown>) {
    const webhookUrl = process.env.DISCORD_OPS_WEBHOOK_URL;
    this.logger.warn({ message, details });

    if (!webhookUrl) return;

    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: `Artemis alert: ${message}`,
          embeds: details
            ? [
                {
                  title: "Details",
                  description: `\`\`\`json\n${JSON.stringify(details, null, 2).slice(0, 3500)}\n\`\`\``
                }
              ]
            : undefined
        })
      });
    } catch (error) {
      this.logger.error("Failed to send ops alert", error);
    }
  }
}
