import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class LlmProviderService {
  private readonly logger = new Logger(LlmProviderService.name);

  /**
   * Dispatch a Fast Tier-1 Specialist LLM Call
   * Prioritizes low-latency models (Groq Llama 3.3, Gemini Flash, OpenRouter)
   */
  async callFastSpecialist<T>(systemPrompt: string, userPrompt: string, fallbackGenerator: () => T): Promise<T> {
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const openAiKey = process.env.OPENAI_API_KEY;

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
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) return JSON.parse(content) as T;
        }
      } catch (err: any) {
        this.logger.warn(`Groq specialist call failed: ${err.message}`);
      }
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
            signal: AbortSignal.timeout(10000),
          },
        );

        if (res.ok) {
          const json = await res.json();
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return JSON.parse(text) as T;
        }
      } catch (err: any) {
        this.logger.warn(`Gemini specialist call failed: ${err.message}`);
      }
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
          signal: AbortSignal.timeout(12000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) return JSON.parse(content) as T;
        }
      } catch (err: any) {
        this.logger.warn(`OpenRouter specialist call failed: ${err.message}`);
      }
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
          signal: AbortSignal.timeout(12000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) return JSON.parse(content) as T;
        }
      } catch (err: any) {
        this.logger.warn(`OpenAI specialist call failed: ${err.message}`);
      }
    }

    // Fallback to deterministic algorithmic generator
    return fallbackGenerator();
  }

  /**
   * Dispatch Tier-2 Master Oracle LLM Call (Prioritizes Google Gemini for deep reasoning and futuristic forecasting)
   */
  async callMasterOracle<T>(systemPrompt: string, userPrompt: string, fallbackGenerator: () => T): Promise<T> {
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const openAiKey = process.env.OPENAI_API_KEY;

    // 1. Primary: Google Gemini 1.5 Pro / Flash (Best for cross-domain synthesis & long-horizon forecasting)
    if (geminiKey) {
      // Try gemini-1.5-pro first for highest cognitive depth, fallback to gemini-1.5-flash
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
          }
        } catch (err: any) {
          this.logger.warn(`Gemini (${model}) master oracle attempt failed: ${err.message}`);
        }
      }
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
        }
      } catch (err: any) {
        this.logger.warn(`OpenRouter master oracle call failed: ${err.message}`);
      }
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
        }
      } catch (err: any) {
        this.logger.warn(`Groq master oracle call failed: ${err.message}`);
      }
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
        }
      } catch (err: any) {
        this.logger.warn(`OpenAI master oracle call failed: ${err.message}`);
      }
    }

    return fallbackGenerator();
  }
}
