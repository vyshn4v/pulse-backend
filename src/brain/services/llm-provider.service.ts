import { Injectable, Logger, BadGatewayException } from '@nestjs/common';

@Injectable()
export class LlmProviderService {
  private readonly logger = new Logger(LlmProviderService.name);
  private readonly openRouterEndpoint = 'https://openrouter.ai/api/v1/chat/completions';

  /**
   * Safely extracts and parses JSON even if wrapped in markdown code blocks like ```json ... ```
   */
  private cleanAndParseJson<T>(rawContent: string): T {
    let cleaned = rawContent.trim();

    // Strip leading and trailing markdown code block tags if present
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    // Extract the substring between the first '{' and the last '}'
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    return JSON.parse(cleaned) as T;
  }

  /**
   * Dispatch Tier-1 Specialist LLM Call via OpenRouter
   * Uses fast models (Meta Llama 3.3 70B / Gemini Flash / Qwen 2.5 via OpenRouter)
   */
  async callFastSpecialist<T>(systemPrompt: string, userPrompt: string, specialistName: string = 'Specialist'): Promise<T> {
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (!openRouterKey) {
      const msg = `[${specialistName}] OPENROUTER_API_KEY is not configured in backend/.env`;
      this.logger.error(msg);
      throw new BadGatewayException(msg);
    }

    // Reliable model list with fallbacks for OpenRouter
    const specialistModels = [
      process.env.OPENROUTER_SPECIALIST_MODEL || 'meta-llama/llama-3.3-70b-instruct',
      'google/gemini-2.0-flash-exp:free',
      'google/gemini-2.0-flash-001',
      'google/gemini-flash-1.5-8b',
      'qwen/qwen-2.5-72b-instruct',
      'deepseek/deepseek-chat',
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
              {
                role: 'system',
                content: `${systemPrompt}\n\nIMPORTANT: Return ONLY valid raw JSON without any markdown formatting, backticks, or explanation.`,
              },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(16000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) {
            try {
              const parsed = this.cleanAndParseJson<T>(content);
              this.logger.log(`[${specialistName}] Successfully generated analysis using OpenRouter (${model})`);
              return parsed;
            } catch (parseErr: any) {
              errors.push(`OpenRouter (${model}) JSON parse error: ${parseErr.message} on output: ${content.slice(0, 100)}...`);
              continue;
            }
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
   * Uses top-tier reasoning models (Gemini / Llama 3.3 / DeepSeek via OpenRouter) for cross-domain forecasting
   */
  async callMasterOracle<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (!openRouterKey) {
      const msg = 'Master Oracle failed: OPENROUTER_API_KEY is not configured in backend/.env';
      this.logger.error(msg);
      throw new BadGatewayException(msg);
    }

    // Reliable oracle model list with fallbacks for OpenRouter
    const oracleModels = [
      process.env.OPENROUTER_ORACLE_MODEL || 'meta-llama/llama-3.3-70b-instruct',
      'google/gemini-2.0-flash-exp:free',
      'google/gemini-2.0-flash-001',
      'google/gemini-pro-1.5',
      'deepseek/deepseek-chat',
      'qwen/qwen-2.5-72b-instruct',
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
              {
                role: 'system',
                content: `${systemPrompt}\n\nIMPORTANT: Return ONLY valid raw JSON without any markdown formatting, backticks, or explanation.`,
              },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.35,
          }),
          signal: AbortSignal.timeout(22000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) {
            try {
              const parsed = this.cleanAndParseJson<T>(content);
              this.logger.log(`Master Oracle synthesis successfully generated using OpenRouter (${model})`);
              return parsed;
            } catch (parseErr: any) {
              errors.push(`OpenRouter (${model}) JSON parse error: ${parseErr.message} on output: ${content.slice(0, 100)}...`);
              continue;
            }
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
