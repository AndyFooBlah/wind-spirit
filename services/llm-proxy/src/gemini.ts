import { GoogleGenAI, type Content, type GenerateContentConfig, type GenerateContentResponse, type ThinkingLevel } from '@google/genai';
import { config, type ModelClass } from './config.js';
import type { GenerateRequest } from './request.js';

let client: GoogleGenAI | undefined;

/** Vertex AI via Application Default Credentials. No API keys, anywhere. */
export function ai(): GoogleGenAI {
  client ??= new GoogleGenAI({ vertexai: true, project: config.project, location: config.location });
  return client;
}

export function modelFor(cls: ModelClass): string {
  return config.models[cls];
}

export interface Usage {
  input: number;
  /** Billed output tokens: visible candidates plus hidden thoughts. */
  output: number;
  thoughts: number;
}

export function usageOf(res: GenerateContentResponse | undefined): Usage {
  const u = res?.usageMetadata;
  const thoughts = u?.thoughtsTokenCount ?? 0;
  return { input: u?.promptTokenCount ?? 0, output: (u?.candidatesTokenCount ?? 0) + thoughts, thoughts };
}

function toContents(req: GenerateRequest): Content[] {
  return req.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
}

function toConfig(req: GenerateRequest, signal: AbortSignal): GenerateContentConfig {
  const cfg: GenerateContentConfig = { abortSignal: signal, httpOptions: { timeout: config.requestTimeoutMs } };
  if (req.system) cfg.systemInstruction = req.system;
  if (req.maxOutputTokens !== undefined) cfg.maxOutputTokens = req.maxOutputTokens;
  if (req.temperature !== undefined) cfg.temperature = req.temperature;
  if (req.schema) {
    cfg.responseMimeType = 'application/json';
    cfg.responseJsonSchema = req.schema;
  }
  if (req.thinkingLevel) cfg.thinkingConfig = { thinkingLevel: req.thinkingLevel as ThinkingLevel };
  return cfg;
}

export async function generate(req: GenerateRequest, signal: AbortSignal): Promise<GenerateContentResponse> {
  return ai().models.generateContent({ model: modelFor(req.class), contents: toContents(req), config: toConfig(req, signal) });
}

export async function generateStream(req: GenerateRequest, signal: AbortSignal): Promise<AsyncGenerator<GenerateContentResponse>> {
  return ai().models.generateContentStream({ model: modelFor(req.class), contents: toContents(req), config: toConfig(req, signal) });
}
