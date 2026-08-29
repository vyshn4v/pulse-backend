import { Injectable, Logger, BadGatewayException } from '@nestjs/common';

@Injectable()
export class LlmProviderService {
  private readonly logger = new Logger(LlmProviderService.name);
  private readonly openRouterEndpoint = 'https://openrouter.ai/api/v1/chat/completions';

  /**
   * Dispatch Tier-1 Specialist LLM Call via OpenRouter
   * Uses fast models (e.g. Google Gemini 2.0 Flash / Llama 3.3 70B via OpenRouter)
   */
  async callFastSpecialist<T>(systemPrompt: string, userPrompt: string, specialistName: string = 'Specialist'): Promise<T> {
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (!openRouterKey) {
      const msg = `[${specialistName}] OPENROUTER_API_KEY is not configured in backend/.env`;
      this.logger.error(msg);
      throw new BadGatewayException(msg);
    }

    // Default fast models via OpenRouter
    const specialistModels = [
      process.env.OPENROUTER_SPECIALIST_MODEL || 'google/gemini-2.0-flash-001',
      'google/gemini-flash-1.5',
      'meta-llama/llama-3.3-70b-instruct',
    ];

    const errors: string[] = [];

    for (const model of specialistModels) {
      try {
        const res = await fetch(this.openRouterEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://pulse.vyshnavpc.com',
            'X-Title': 'PULSE Autonomous OS - Specialist',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) {
            this.logger.log(`[${specialistName}] Successfully generated analysis using OpenRouter (${model})`);
            return JSON.parse(content) as T;
          }
          errors.push(`OpenRouter (${model}) returned empty message content`);
        } else {
          const errText = await res.text();
          errors.push(`OpenRouter (${model}) HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`OpenRouter (${model}) error: ${err.message}`);
        this.logger.warn(`[${specialistName}] OpenRouter (${model}) attempt failed: ${err.message}`);
      }
    }

    const errorMsg = `[${specialistName}] OpenRouter generation failed. Details: ${errors.join(' | ')}`;
    this.logger.error(errorMsg);
    throw new BadGatewayException(errorMsg);
  }

  /**
   * Dispatch Tier-2 Master Oracle LLM Call via OpenRouter
   * Uses top-tier reasoning models (Gemini 2.0 Flash / Gemini 1.5 Pro via OpenRouter) for cross-domain forecasting
   */
  async callMasterOracle<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (!openRouterKey) {
      const msg = 'Master Oracle failed: OPENROUTER_API_KEY is not configured in backend/.env';
      this.logger.error(msg);
      throw new BadGatewayException(msg);
    }

    // Default oracle models via OpenRouter
    const oracleModels = [
      process.env.OPENROUTER_ORACLE_MODEL || 'google/gemini-2.0-flash-001',
      'google/gemini-pro-1.5',
      'google/gemini-flash-1.5',
      'meta-llama/llama-3.3-70b-instruct',
    ];

    const errors: string[] = [];

    for (const model of oracleModels) {
      try {
        const res = await fetch(this.openRouterEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://pulse.vyshnavpc.com',
            'X-Title': 'PULSE Chief Strategic Intelligence Oracle',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.35,
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) {
            this.logger.log(`Master Oracle synthesis successfully generated using OpenRouter (${model})`);
            return JSON.parse(content) as T;
          }
          errors.push(`OpenRouter (${model}) returned empty message content`);
        } else {
          const errText = await res.text();
          errors.push(`OpenRouter (${model}) HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`OpenRouter (${model}) error: ${err.message}`);
        this.logger.warn(`Master Oracle OpenRouter (${model}) attempt failed: ${err.message}`);
      }
    }

    const errorMsg = `Master Oracle synthesis failed via OpenRouter. Details: ${errors.join(' | ')}`;
    this.logger.error(errorMsg);
    throw new BadGatewayException(errorMsg);
  }
}
