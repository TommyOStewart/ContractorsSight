export interface Transcription {
  text: string;
  costUsd: number;
}

/** Speech-to-text. The worker holds the API keys; the phone never calls a model. */
export interface Transcriber {
  readonly id: string;
  transcribe(audio: Uint8Array, format: "m4a" | "wav" | "mp3" | "aac" | "ogg" | "webm"): Promise<Transcription>;
}

const ENDPOINT = "https://openrouter.ai/api/v1/audio/transcriptions";

/** OpenRouter's speech-to-text endpoint (JSON body, base64 audio). */
export class OpenRouterTranscriber implements Transcriber {
  constructor(
    private readonly options: { apiKey: string; model: string; language?: string; fetchImpl?: typeof fetch },
  ) {}

  get id() {
    return this.options.model;
  }

  async transcribe(audio: Uint8Array, format: Parameters<Transcriber["transcribe"]>[1]): Promise<Transcription> {
    const res = await (this.options.fetchImpl ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json", "x-title": "ContractorSight" },
      body: JSON.stringify({
        model: this.options.model,
        input_audio: { data: Buffer.from(audio).toString("base64"), format },
        language: this.options.language ?? "en",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string; usage?: { cost?: number }; error?: { message?: string } };
    if (!res.ok || typeof data.text !== "string") {
      throw new Error(`Transcription failed (${res.status}): ${data.error?.message ?? "no text returned"}`);
    }
    return { text: data.text.trim(), costUsd: data.usage?.cost ?? 0 };
  }
}
