import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PineconeService } from '../pinecone/pinecone.service';
import { AskAiQueryDto, AiQueryResponseDto, AiSourceCitation } from './ai-query.dto';

@Injectable()
export class AiQueryService {
  private readonly logger = new Logger(AiQueryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pineconeService: PineconeService,
  ) {}

  async askQuery(userId: number, dto: AskAiQueryDto): Promise<AiQueryResponseDto> {
    const startTime = Date.now();
    const queryText = dto.query.trim();

    this.logger.log(`Executing Pinecone Vector RAG Query for user #${userId}: "${queryText.slice(0, 60)}..."`);

    // 1. Fetch user persona (single row lookup) & query Pinecone Vector Index in parallel
    const [meProfile, vectorMatches] = await Promise.all([
      this.prisma.meProfile.findUnique({ where: { userId } }),
      this.pineconeService.querySemanticMemories(userId, queryText, 8),
    ]);

    // 2. Map Vector Matches to Citations (NO FULL TABLE SCANS)
    let sources: AiSourceCitation[] = vectorMatches.map((m) => ({
      type: m.sourceType,
      id: m.sourceId || m.id,
      title: m.title,
      snippet: m.snippet,
      timestamp: m.timestamp,
    }));

    // If vector store is cold/empty for this user, trigger lazy background indexing and fetch light fallback
    if (sources.length === 0) {
      this.triggerLazyBackgroundVectorSync(userId).catch((err) =>
        this.logger.warn(`Background vector sync notice: ${err.message}`),
      );

      // Light targeted sample while vector index warms up
      const [recentActivities, recentJobs, recentSolved] = await Promise.all([
        this.prisma.activityLog.findMany({ where: { userId }, take: 4, orderBy: { date: 'desc' } }),
        this.prisma.jobApplication.findMany({ where: { userId }, take: 3, orderBy: { appliedAt: 'desc' } }),
        this.prisma.leetCodeSubmission.findMany({ where: { userId }, take: 3, orderBy: { timestamp: 'desc' } }),
      ]);

      recentActivities.forEach((a) => {
        sources.push({
          type: 'activity',
          id: a.id,
          title: `[Activity] ${a.title || a.category}`,
          snippet: `${a.title}: ${a.description} (${a.category}, ${a.status})`,
          timestamp: a.date.toISOString(),
        });
      });
      recentJobs.forEach((j) => {
        sources.push({
          type: 'job',
          id: j.id,
          title: `[Job] ${j.company} - ${j.role}`,
          snippet: `${j.company} (${j.role}) - Status: ${j.status}`,
          timestamp: j.appliedAt.toISOString(),
        });
      });
      recentSolved.forEach((p) => {
        sources.push({
          type: 'leetcode',
          id: p.id,
          title: `[LeetCode] ${p.title} (${p.difficulty})`,
          snippet: `${p.title} [${p.difficulty}] - Status: ${p.status}. Topics: ${p.topics.join(', ')}`,
          timestamp: p.timestamp.toISOString(),
        });
      });
    }

    // 3. Assemble Grounded Vector Context for LLM
    const systemPrompt = `You are PULSE AI — an intelligent, context-aware engineering copilot and personal career assistant.
You have access to the user's real-time operational ledger, LeetCode DSA solving telemetry, career job pipeline, LinkedIn content queue, and daily cognitive syntheses retrieved via Pinecone Vector RAG.

BEHAVIOR & INTENT GUIDELINES (DECIDE DYNAMICALLY BASED ON USER INPUT):
1. Conversational & Pleasantries:
   - If the user sends a greeting (e.g. "hi", "hello", "hey"), gratitude (e.g. "okay thank you", "thanks", "appreciate it"), acknowledgement ("ok", "got it", "cool"), or small talk ("how are you"), respond naturally, warmly, politely, and conversationally like a true AI partner.
   - DO NOT generate unsolicited telemetry reports, data tables, or raw database dumps for simple conversational pleasantries.
2. Technical, Career & Analytical Questions:
   - When the user asks about their tasks, engineering work, LeetCode/DSA problem solving, job applications, interview stages, or content, synthesize an accurate, insightful, and structured response grounded in the provided vector context below.
   - Cite specific activities, companies, or problems when relevant.
3. Formatting:
   - Format responses in clean, modern Markdown.`;

    const contextText = `
=== USER PROFILE & PERSONA ===
Persona: ${meProfile?.whoAmI || 'Senior Software Engineer'}
Goals: ${meProfile?.goals || 'Distributed Systems, DSA Mastery, Senior Roles'}
Focus Domains: ${meProfile?.brainBehaviorPrefs ? JSON.stringify((meProfile.brainBehaviorPrefs as any).focusDomains || []) : '[]'}

=== RELEVANT SEMANTIC MEMORIES (Retrieved via Pinecone Vector RAG) ===
${sources.map((s) => `- [${s.type.toUpperCase()}] ${s.title}: ${s.snippet}`).join('\n\n') || 'No specific historical records matched this query.'}
`;

    const userPrompt = `${contextText}\n\n=== USER QUESTION ===\n${queryText}`;

    let answer = '';
    let modelUsed = 'pinecone-rag-engine';

    try {
      // 4. Dispatch to LLM
      const result = await this.callLLM(systemPrompt, userPrompt, queryText, sources, dto.model);
      answer = result.answer;
      modelUsed = result.modelUsed;
    } catch (err: any) {
      this.logger.warn(`LLM execution error in askQuery: ${err.message}`);
      answer = `⏱️ **AI Model Request Timed Out**\n\nThe LLM service took too long to respond. Please click the **🔄 Retry** button above to try again.`;
      modelUsed = 'timeout';
    }

    const latencyMs = Date.now() - startTime;

    // 5. Persist Query Log to PostgreSQL
    let savedId = Date.now();
    try {
      const savedLog = await this.prisma.aiQueryLog.create({
        data: {
          userId,
          query: queryText,
          answer,
          sources: sources.slice(0, 10) as any,
          latencyMs,
          modelUsed,
        },
      });
      savedId = savedLog.id;
    } catch (dbErr: any) {
      this.logger.warn(`Could not save aiQueryLog to DB: ${dbErr.message}`);
    }

    return {
      id: savedId,
      query: queryText,
      answer,
      sources: sources.slice(0, 8),
      latencyMs,
      modelUsed,
      createdAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Real-Time Server-Sent Events (SSE) Token Streaming
  // ---------------------------------------------------------------------------

  async streamQuery(userId: number, dto: AskAiQueryDto, res: any, req?: any): Promise<void> {
    const startTime = Date.now();
    const queryText = dto.query.trim();

    // Fastify raw response setup for Server-Sent Events
    const rawRes = res.raw || res;
    const origin = req?.headers?.origin || process.env.FRONTEND_URL || '*';

    if (rawRes.setHeader) {
      if (origin) {
        rawRes.setHeader('Access-Control-Allow-Origin', origin);
        rawRes.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      rawRes.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie',
      );
      rawRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      rawRes.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      rawRes.setHeader('Cache-Control', 'no-cache, no-transform');
      rawRes.setHeader('Connection', 'keep-alive');
      rawRes.setHeader('X-Accel-Buffering', 'no');
    }

    const sendEvent = (event: string, data: any) => {
      try {
        rawRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {}
    };

    // 1. Vector RAG Retrieval (<20ms)
    const [meProfile, vectorMatches] = await Promise.all([
      this.prisma.meProfile.findUnique({ where: { userId } }),
      this.pineconeService.querySemanticMemories(userId, queryText, 8),
    ]);

    const sources: AiSourceCitation[] = vectorMatches.map((m) => ({
      type: m.sourceType,
      id: m.sourceId || m.id,
      title: m.title,
      snippet: m.snippet,
      timestamp: m.timestamp,
    }));

    // Send sources event immediately to client
    sendEvent('sources', { sources: sources.slice(0, 8) });

    // 2. Prepare Context & Prompt
    const systemPrompt = `You are PULSE AI — an intelligent, context-aware engineering copilot and personal career assistant.
You have access to the user's real-time operational ledger, LeetCode DSA solving telemetry, career job pipeline, LinkedIn content queue, and daily cognitive syntheses retrieved via Pinecone Vector RAG.

BEHAVIOR & INTENT GUIDELINES:
1. Conversational & Pleasantries:
   - If the user sends a greeting ("hi", "hello", "hey"), gratitude ("okay thank you", "thanks"), or pleasantry ("how are you"), respond naturally and warmly. DO NOT output an unsolicited telemetry dump.
2. Technical & Career Questions:
   - For questions about tasks, engineering work, LeetCode, or jobs, synthesize an insightful, grounded answer using the provided context.
3. Formatting:
   - Format in clean Markdown.`;

    const contextText = `
=== USER PROFILE & PERSONA ===
Persona: ${meProfile?.whoAmI || 'Senior Software Engineer'}
Goals: ${meProfile?.goals || 'Distributed Systems, DSA Mastery, Senior Roles'}

=== RELEVANT SEMANTIC MEMORIES (Retrieved via Pinecone Vector RAG) ===
${sources.map((s) => `- [${s.type.toUpperCase()}] ${s.title}: ${s.snippet}`).join('\n\n') || 'No specific historical records matched this query.'}
`;

    const userPrompt = `${contextText}\n\n=== USER QUESTION ===\n${queryText}`;

    // 3. Stream Tokens
    let fullAnswer = '';
    let modelUsed = 'pinecone-stream';

    try {
      const streamResult = await this.streamLLM(
        systemPrompt,
        userPrompt,
        dto.model,
        (token: string) => {
          fullAnswer += token;
          sendEvent('token', { token });
        },
      );
      modelUsed = streamResult.modelUsed;
    } catch (err: any) {
      this.logger.warn(`Streaming error: ${err.message}`);
      if (!fullAnswer) {
        fullAnswer = `⏱️ **AI Model Request Timed Out**\n\nThe LLM service took too long to respond. Please click the **🔄 Retry** button above to try again.`;
        sendEvent('token', { token: fullAnswer });
        modelUsed = 'timeout';
      }
    }

    const latencyMs = Date.now() - startTime;

    // 4. Persist to DB
    let savedId = Date.now();
    try {
      const savedLog = await this.prisma.aiQueryLog.create({
        data: {
          userId,
          query: queryText,
          answer: fullAnswer,
          sources: sources.slice(0, 10) as any,
          latencyMs,
          modelUsed,
        },
      });
      savedId = savedLog.id;
    } catch {}

    // Send completion event
    sendEvent('done', {
      id: savedId,
      answer: fullAnswer,
      latencyMs,
      modelUsed,
      createdAt: new Date().toISOString(),
    });

    try {
      rawRes.end();
    } catch {}
  }

  // Lazy one-time warm-up to vectorize all records into Pinecone
  private async triggerLazyBackgroundVectorSync(userId: number) {
    const [activities, jobs, solved, posts, syntheses] = await Promise.all([
      this.prisma.activityLog.findMany({ where: { userId }, take: 50, orderBy: { date: 'desc' } }),
      this.prisma.jobApplication.findMany({ where: { userId }, take: 50, orderBy: { appliedAt: 'desc' } }),
      this.prisma.leetCodeSubmission.findMany({ where: { userId }, take: 50, orderBy: { timestamp: 'desc' } }),
      this.prisma.linkedInPost.findMany({ where: { userId }, take: 30, orderBy: { createdAt: 'desc' } }),
      this.prisma.dailySynthesis.findMany({ where: { userId }, take: 10, orderBy: { createdAt: 'desc' } }),
    ]);

    const records: Array<any> = [];

    activities.forEach((a) => {
      records.push({
        id: `act_${a.id}`,
        sourceType: 'activity',
        sourceId: a.id,
        title: a.title || a.category,
        content: `${a.title}: ${a.description} (Category: ${a.category}, Status: ${a.status})`,
        timestamp: a.date.toISOString(),
      });
    });

    jobs.forEach((j) => {
      records.push({
        id: `job_${j.id}`,
        sourceType: 'job',
        sourceId: j.id,
        title: `${j.company} - ${j.role}`,
        content: `${j.company} (${j.role}) - Status: ${j.status}. Source: ${j.source}. Notes: ${j.notes || ''}`,
        timestamp: j.appliedAt.toISOString(),
      });
    });

    solved.forEach((p) => {
      records.push({
        id: `lc_${p.id}`,
        sourceType: 'leetcode',
        sourceId: p.id,
        title: `${p.title} (${p.difficulty})`,
        content: `${p.title} [${p.difficulty}] - Status: ${p.status}. Topics: ${p.topics.join(', ')}. Notes: ${p.notes || ''}`,
        timestamp: p.timestamp.toISOString(),
      });
    });

    posts.forEach((po) => {
      records.push({
        id: `li_${po.id}`,
        sourceType: 'linkedin',
        sourceId: po.id,
        title: po.topic || 'LinkedIn Post',
        content: `${po.content} (Status: ${po.status}, Impressions: ${po.impressions || 0})`,
        timestamp: po.createdAt.toISOString(),
      });
    });

    syntheses.forEach((s) => {
      records.push({
        id: `syn_${s.id}`,
        sourceType: 'synthesis',
        sourceId: s.id,
        title: `Daily Synthesis · ${new Date(s.date).toLocaleDateString()}`,
        content: `${s.summary}\n\nKey Highlights:\n${s.highlights.join('\n')}\n\nAction Items:\n${s.actionItems.join('\n')}`,
        timestamp: s.date.toISOString(),
      });
    });

    if (records.length > 0) {
      await this.pineconeService.bulkUpsertMemories(userId, records);
    }
  }

  private async callLLM(
    systemPrompt: string,
    userPrompt: string,
    queryText: string,
    sources: AiSourceCitation[],
    preferredModel?: string,
  ): Promise<{ answer: string; modelUsed: string }> {
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (!openRouterKey) {
      throw new Error('OPENROUTER_API_KEY is not configured in backend/.env');
    }

    const models = [
      preferredModel && preferredModel !== 'auto' ? preferredModel : 'google/gemini-2.0-flash-001',
      'google/gemini-flash-1.5',
      'meta-llama/llama-3.3-70b-instruct',
    ];

    for (const model of models) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://pulse.vyshnavpc.com',
            'X-Title': 'PULSE Autonomous AI Query',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            temperature: 0.4,
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) return { answer: content, modelUsed: model };
        }
      } catch (err: any) {
        this.logger.warn(`OpenRouter (${model}) attempt failed: ${err.message}`);
      }
    }

    this.logger.warn('All OpenRouter models timed out or failed.');
    return {
      answer: `⏱️ **AI Model Request Timed Out**\n\nThe OpenRouter service took too long to respond. Please click the **🔄 Retry** button above.`,
      modelUsed: 'timeout',
    };
  }

  private async streamLLM(
    systemPrompt: string,
    userPrompt: string,
    preferredModel: string | undefined,
    onToken: (token: string) => void,
  ): Promise<{ modelUsed: string }> {
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (!openRouterKey) {
      throw new Error('OPENROUTER_API_KEY is not configured in backend/.env');
    }

    const models = [
      preferredModel && preferredModel !== 'auto' ? preferredModel : 'google/gemini-2.0-flash-001',
      'google/gemini-flash-1.5',
      'meta-llama/llama-3.3-70b-instruct',
    ];

    for (const model of models) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://pulse.vyshnavpc.com',
            'X-Title': 'PULSE Autonomous AI Query Stream',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            temperature: 0.4,
            stream: true,
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (res.ok && res.body) {
          await this.consumeSseStream(res.body, onToken);
          return { modelUsed: model };
        }
      } catch (err: any) {
        this.logger.warn(`OpenRouter stream (${model}) fallback: ${err.message}`);
      }
    }

    throw new Error('All OpenRouter streaming models timed out');
  }

  private async consumeSseStream(body: any, onDelta: (delta: string) => void): Promise<void> {
    const reader = body.getReader ? body.getReader() : null;
    if (reader) {
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) onDelta(delta);
            } catch {}
          }
        }
      }
    }
  }

  async getHistory(userId: number, limit: number = 30) {
    return this.prisma.aiQueryLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async deleteHistoryItem(userId: number, id: number) {
    const log = await this.prisma.aiQueryLog.findFirst({
      where: { id, userId },
    });
    if (!log) throw new NotFoundException(`Query log #${id} not found`);

    return this.prisma.aiQueryLog.delete({ where: { id } });
  }

  async clearHistory(userId: number) {
    return this.prisma.aiQueryLog.deleteMany({ where: { userId } });
  }
}
