import { Injectable, Logger, BadGatewayException } from '@nestjs/common';

@Injectable()
export class LlmProviderService {
  private readonly logger = new Logger(LlmProviderService.name);

  /**
   * Dispatch a Fast Tier-1 Specialist LLM Call
   * Prioritizes low-latency models (Groq Llama 3.3, Gemini Flash, OpenRouter)
   * Throws an error if all providers fail (No hardcoded fake fallbacks).
   */
  async callFastSpecialist<T>(systemPrompt: string, userPrompt: string, specialistName: string = 'Specialist'): Promise<T> {
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const openAiKey = process.env.OPENAI_API_KEY;

    const errors: string[] = [];

    // 1. Try Groq (Ultra-low latency for micro-specialists)
    if (groqKey) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${groqKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(12000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) return JSON.parse(content) as T;
          errors.push('Groq returned empty response content');
        } else {
          const errText = await res.text();
          errors.push(`Groq HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`Groq exception: ${err.message}`);
        this.logger.warn(`[${specialistName}] Groq attempt failed: ${err.message}`);
      }
    } else {
      errors.push('GROQ_API_KEY not configured');
    }

    // 2. Try Gemini Flash
    if (geminiKey) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
              generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
            }),
            signal: AbortSignal.timeout(12000),
          },
        );

        if (res.ok) {
          const json = await res.json();
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return JSON.parse(text) as T;
          errors.push('Gemini returned empty response candidate');
        } else {
          const errText = await res.text();
          errors.push(`Gemini HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`Gemini exception: ${err.message}`);
        this.logger.warn(`[${specialistName}] Gemini Flash attempt failed: ${err.message}`);
      }
    } else {
      errors.push('GEMINI_API_KEY/GOOGLE_API_KEY not configured');
    }

    // 3. Try OpenRouter
    if (openRouterKey) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(14000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) return JSON.parse(content) as T;
          errors.push('OpenRouter returned empty response content');
        } else {
          const errText = await res.text();
          errors.push(`OpenRouter HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`OpenRouter exception: ${err.message}`);
        this.logger.warn(`[${specialistName}] OpenRouter attempt failed: ${err.message}`);
      }
    } else {
      errors.push('OPENROUTER_API_KEY not configured');
    }

    // 4. Try OpenAI
    if (openAiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(14000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) return JSON.parse(content) as T;
          errors.push('OpenAI returned empty response content');
        } else {
          const errText = await res.text();
          errors.push(`OpenAI HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`OpenAI exception: ${err.message}`);
        this.logger.warn(`[${specialistName}] OpenAI attempt failed: ${err.message}`);
      }
    } else {
      errors.push('OPENAI_API_KEY not configured');
    }

    // If all providers fail, do not return fake mock data - throw explicit failure
    const errorMsg = `[${specialistName}] AI generation failed. All providers unsuccessful. Details: ${errors.join(' | ')}`;
    this.logger.error(errorMsg);
    throw new BadGatewayException(errorMsg);
  }

  /**
   * Dispatch Tier-2 Master Oracle LLM Call
   * Prioritizes Google Gemini for deep reasoning and futuristic forecasting.
   * Throws an error if all providers fail (No hardcoded fake fallbacks).
   */
  async callMasterOracle<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const openAiKey = process.env.OPENAI_API_KEY;

    const errors: string[] = [];

    // 1. Primary: Google Gemini (1.5 Pro / Flash)
    if (geminiKey) {
      const models = ['gemini-1.5-pro', 'gemini-1.5-flash'];
      for (const model of models) {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
                generationConfig: { responseMimeType: 'application/json', temperature: 0.35 },
              }),
              signal: AbortSignal.timeout(18000),
            },
          );

          if (res.ok) {
            const json = await res.json();
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) return JSON.parse(text) as T;
            errors.push(`Gemini (${model}) returned empty text candidate`);
          } else {
            const errText = await res.text();
            errors.push(`Gemini (${model}) HTTP ${res.status}: ${errText}`);
          }
        } catch (err: any) {
          errors.push(`Gemini (${model}) exception: ${err.message}`);
          this.logger.warn(`Gemini (${model}) master oracle attempt failed: ${err.message}`);
        }
      }
    } else {
      errors.push('GEMINI_API_KEY/GOOGLE_API_KEY not configured');
    }

    // 2. Secondary: OpenRouter
    if (openRouterKey) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.35,
          }),
          signal: AbortSignal.timeout(18000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) return JSON.parse(content) as T;
          errors.push('OpenRouter returned empty response content');
        } else {
          const errText = await res.text();
          errors.push(`OpenRouter HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`OpenRouter exception: ${err.message}`);
        this.logger.warn(`OpenRouter master oracle attempt failed: ${err.message}`);
      }
    } else {
      errors.push('OPENROUTER_API_KEY not configured');
    }

    // 3. Tertiary: Groq
    if (groqKey) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${groqKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.35,
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) return JSON.parse(content) as T;
          errors.push('Groq returned empty response content');
        } else {
          const errText = await res.text();
          errors.push(`Groq HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`Groq exception: ${err.message}`);
        this.logger.warn(`Groq master oracle attempt failed: ${err.message}`);
      }
    } else {
      errors.push('GROQ_API_KEY not configured');
    }

    // 4. OpenAI
    if (openAiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.35,
          }),
          signal: AbortSignal.timeout(18000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) return JSON.parse(content) as T;
          errors.push('OpenAI returned empty response content');
        } else {
          const errText = await res.text();
          errors.push(`OpenAI HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`OpenAI exception: ${err.message}`);
        this.logger.warn(`OpenAI master oracle attempt failed: ${err.message}`);
      }
    } else {
      errors.push('OPENAI_API_KEY not configured');
    }

    // Explicit error - No fake hardcoded synthesis
    const errorMsg = `Master Oracle synthesis failed. All AI providers unsuccessful. Details: ${errors.join(' | ')}`;
    this.logger.error(errorMsg);
    throw new BadGatewayException(errorMsg);
  }
}
