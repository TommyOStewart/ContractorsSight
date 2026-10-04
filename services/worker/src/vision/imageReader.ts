export interface ImageReading {
  text: string;
  costUsd: number;
}

/**
 * Photo → text (handwritten notes, receipts, invoices). The text step for image captures, so photos
 * go through the same planner as voice and typed notes.
 */
export interface ImageReader {
  readonly id: string;
  read(images: { bytes: Uint8Array; mimeType: string }[]): Promise<ImageReading>;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const INSTRUCTIONS = `You read photos a trade contractor took of their own paperwork: handwritten notes, job sheets, supply-house receipts and invoices.

Transcribe every piece of text you can see, exactly as written. Don't summarize, interpret, correct spelling, or expand abbreviations; another step does that.
- Keep the layout useful: one line per line of text; for receipts keep item, quantity and price on the same line.
- If a word or number is unreadable, write [?] in its place. If you're unsure between readings, write the likeliest followed by [?].
- If there are several photos, separate them with a line "--- page N ---".
- If a photo has no readable text, reply exactly: (no text)
Reply with the transcription only.`;

/** Reads images with a vision model through OpenRouter. */
export class OpenRouterImageReader implements ImageReader {
  constructor(private readonly options: { apiKey: string; model: string; fetchImpl?: typeof fetch }) {}

  get id() {
    return this.options.model;
  }

  async read(images: { bytes: Uint8Array; mimeType: string }[]): Promise<ImageReading> {
    const res = await (this.options.fetchImpl ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json", "x-title": "ContractorSight" },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          { role: "system", content: INSTRUCTIONS },
          {
            role: "user",
            content: images.map((img) => ({
              type: "image_url",
              image_url: { url: `data:${img.mimeType};base64,${Buffer.from(img.bytes).toString("base64")}` },
            })),
          },
        ],
        // Transcription needs eyes, not deliberation.
        reasoning: { effort: "low" },
        max_tokens: 4000,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { cost?: number };
      error?: { message?: string };
    };
    const text = data.choices?.[0]?.message?.content;
    if (!res.ok || typeof text !== "string") {
      throw new Error(`Reading the photo failed (${res.status}): ${data.error?.message ?? "no text returned"}`);
    }
    const trimmed = text.trim();
    return { text: trimmed === "(no text)" ? "" : trimmed, costUsd: data.usage?.cost ?? 0 };
  }
}
