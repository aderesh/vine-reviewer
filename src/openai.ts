import type { ProductInfo, GeneratedReview, ReviewCharacteristic } from './types';
import { getSettings } from './storage';

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(
  template: string,
  product: ProductInfo,
  userNotes: string,
  starRating: number,
  checkedCharacteristics?: string[],
): string {
  const charText = checkedCharacteristics?.length
    ? checkedCharacteristics.map((c) => `• ${c}`).join('\n')
    : 'None';

  let result = template
    .replace('{productTitle}', product.title)
    .replace('{features}', product.features.map((f) => `• ${f}`).join('\n') || 'N/A')
    .replace('{description}', product.description || 'N/A')
    .replace('{userNotes}', userNotes)
    .replace('{starRating}', String(starRating))
    .replace('{characteristics}', charText);

  // Fallback: if the template had no {characteristics} placeholder but the user
  // did check some characteristics, inject them before the JSON instruction.
  if (checkedCharacteristics?.length && !template.includes('{characteristics}')) {
    const injection =
      `\nCharacteristics I agree with from other buyer reviews (mention each one naturally in the review):\n${charText}\n`;
    // Insert before "Respond with valid JSON" if present, otherwise append.
    const jsonMarker = result.indexOf('Respond with valid JSON');
    if (jsonMarker !== -1) {
      result = result.slice(0, jsonMarker) + injection + result.slice(jsonMarker);
    } else {
      result += injection;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal API helper
// ---------------------------------------------------------------------------

interface AiCallOptions {
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  maxTokens: number;
  jsonMode?: boolean;
}

async function callAiApi(
  endpoint: string,
  apiKey: string,
  model: string,
  options: AiCallOptions,
): Promise<string> {
  const base = endpoint.replace(/\/$/, '');
  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
  };
  if (options.jsonMode) body.response_format = { type: 'json_object' };

  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 429) throw new Error('Rate limit reached (429). Wait a moment and try again.');
    const err = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(`AI API error ${response.status}: ${err?.error?.message ?? response.statusText}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() ?? '';
  return content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

export async function generateReview(
  product: ProductInfo,
  userNotes: string,
  starRating: number,
  checkedCharacteristics?: string[],
): Promise<GeneratedReview> {
  const settings = await getSettings();

  if (!settings.openaiApiKey) {
    throw new Error(
      'API key is not set. Open the extension options and add your key.',
    );
  }

  const userPrompt = buildPrompt(
    settings.reviewPromptTemplate,
    product,
    userNotes,
    starRating,
    checkedCharacteristics,
  );

  // Force JSON output on providers that support it (Groq, OpenAI).
  // Gemini's OpenAI-compat layer ignores unknown fields, so safe to always send.
  const jsonStr = await callAiApi(settings.apiEndpoint, settings.openaiApiKey, settings.openaiModel, {
    messages: [
      { role: 'system', content: settings.systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    maxTokens: 900,
    jsonMode: true,
  });

  if (!jsonStr) {
    throw new Error('Empty AI response. Try regenerating.');
  }

  const tryParse = (s: string): { title: string; body: string } | null => {
    try {
      const p = JSON.parse(s) as { title?: string; body?: string };
      if (p.title && p.body) return { title: p.title, body: p.body };
    } catch {
      // handled below
    }
    return null;
  };

  // Attempt 1: parse as-is
  const direct = tryParse(jsonStr);
  if (direct) return direct;

  // Attempt 2: some models (Groq/Llama) emit actual newline characters inside
  // JSON string values, which is invalid JSON. Escape them with a
  // character-by-character pass that only touches newlines inside strings.
  const sanitized = escapeNewlinesInStrings(jsonStr);
  const fallback = tryParse(sanitized);
  if (fallback) return fallback;

  // Attempt 3: model added preamble/postamble — extract just the {...} block.
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const extracted = jsonStr.slice(start, end + 1);
    const fromExtracted = tryParse(extracted) ?? tryParse(escapeNewlinesInStrings(extracted));
    if (fromExtracted) return fromExtracted;
  }

  throw new Error(
    'Failed to parse the AI response as JSON. Try regenerating, or adjust the review prompt in options.',
  );
}

/**
 * Escapes bare newline/carriage-return characters that appear inside JSON
 * string values. Structural whitespace (outside strings) is left alone.
 */
function escapeNewlinesInStrings(s: string): string {
  let result = '';
  let inString = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inString) {
      if (ch === '\\') {
        // Pass the escape sequence through unchanged
        result += ch + (s[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (ch === '"') {
        // Determine if this quote closes the string or is stray content.
        // A closing quote is followed (after optional whitespace) by a JSON
        // structural character: : , } ]
        let j = i + 1;
        while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++;
        const next = s[j];
        if (next === ':' || next === ',' || next === '}' || next === ']' || j >= s.length) {
          inString = false;
          result += ch;
        } else {
          // Stray quote inside a string value — escape it
          result += '\\"';
        }
      } else if (ch === '\n') {
        result += '\\n';
      } else if (ch === '\r') {
        result += '\\r';
      } else {
        result += ch;
      }
    } else {
      if (ch === '"') inString = true;
      result += ch;
    }
    i++;
  }
  return result;
}

// Try to parse a JSON string; on failure, attempt to salvage a partial array
// by trimming to the last complete object (handles finish_reason: length).
function parseJsonArray(raw: string): unknown[] {
  const sanitized = escapeNewlinesInStrings(raw);
  try {
    return JSON.parse(sanitized);
  } catch {
    // Find the last },{  or }] pattern to close a partial array
    const lastClose = sanitized.lastIndexOf('},');
    if (lastClose > 1) {
      try {
        return JSON.parse(sanitized.slice(0, lastClose + 1) + ']');
      } catch { /* fall through */ }
    }
    throw new SyntaxError(`JSON parse failed: ${sanitized.slice(0, 120)}…`);
  }
}

// ---------------------------------------------------------------------------
// Characteristics extractor
// ---------------------------------------------------------------------------

/**
 * Asks the AI to analyse scraped review texts and return a deduplicated list
 * of product characteristics sorted by how many reviews mention them.
 *
 * Can be called directly from the side panel (no background message needed).
 */
export async function extractCharacteristics(
  positiveReviews: { text: string; url: string | null }[],
  criticalReviews: { text: string; url: string | null }[],
): Promise<ReviewCharacteristic[]> {
  const settings = await getSettings();
  if (!settings.openaiApiKey) return [];

  const limit = settings.reviewCount;

  const posSlice = positiveReviews.slice(0, limit);
  const critSlice = criticalReviews.slice(0, limit);

  const posBlock = posSlice.length
    ? posSlice.map((r, i) => `[${i}] ${r.text}`).join('\n\n')
    : '(none)';
  const critBlock = critSlice.length
    ? critSlice.map((r, i) => `[${i}] ${r.text}`).join('\n\n')
    : '(none)';

  const prompt = `Analyze these Amazon product reviews and extract the key characteristics/aspects customers mention.

POSITIVE REVIEWS:
${posBlock}

CRITICAL REVIEWS:
${critBlock}

Return ONLY a JSON array of up to ${settings.characteristicsCount} characteristics, sorted by count descending.
Each item: {"text":"concise 3-7 word phrase, lowercase","sentiment":"positive" or "negative","count":N,"sources":[{"list":"positive" or "critical","index":0-based review index,"sentence":"the exact sentence(s) from that review proving this characteristic"}]}
Deduplicate similar ideas. "count" is how many of the provided reviews mention this characteristic. Include one source entry per supporting review.`;

  const jsonStr = await callAiApi(settings.apiEndpoint, settings.openaiApiKey, settings.openaiModel, {
    messages: [
      { role: 'system', content: 'You extract product characteristics from reviews. Respond only with valid JSON.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    maxTokens: 2000,
  });
  const parsed = parseJsonArray(jsonStr) as Array<{
    text?: string; sentiment?: string; count?: number;
    sources?: Array<{ list?: string; index?: number; sentence?: string }>;
  }>;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((c) => c.text && c.sentiment && typeof c.count === 'number')
    .slice(0, settings.characteristicsCount)
    .map((c) => ({
      text: c.text!,
      sentiment: c.sentiment as 'positive' | 'negative',
      count: c.count!,
      sources: (c.sources ?? [])
        .filter((s) => s.sentence && typeof s.index === 'number')
        .map((s) => {
          const pool = s.list === 'critical' ? critSlice : posSlice;
          return {
            excerpt: s.sentence!,
            url: (s.index! >= 0 && s.index! < pool.length) ? pool[s.index!].url : null,
          };
        }),
    }));
}

// ---------------------------------------------------------------------------
// Review guidance questions
// ---------------------------------------------------------------------------

/**
 * Generates a list of category-specific questions to guide the reviewer.
 * e.g. for a router: "How is the Wi-Fi range?", "Was setup straightforward?"
 */
export async function generateReviewQuestions(product: ProductInfo): Promise<string[]> {
  const settings = await getSettings();
  if (!settings.openaiApiKey) return [];

  const featuresLine = product.features.slice(0, 6).join('; ');
  const descLine = product.description ? product.description.slice(0, 400) : '';

  const prompt = settings.questionsPromptTemplate
    .replace('{productTitle}', product.title)
    .replace('{features}', featuresLine ? `Features: ${featuresLine}` : '')
    .replace('{description}', descLine ? `Description: ${descLine}` : '');

  const jsonStr = await callAiApi(settings.apiEndpoint, settings.openaiApiKey, settings.openaiModel, {
    messages: [
      { role: 'system', content: 'You help reviewers write thorough product reviews. Respond only with valid JSON.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.4,
    maxTokens: 400,
    jsonMode: true,
  });
  const parsed = JSON.parse(escapeNewlinesInStrings(jsonStr)) as { questions?: unknown };
  const arr = Array.isArray(parsed) ? parsed : (parsed.questions ?? Object.values(parsed)[0]);
  if (!Array.isArray(arr)) return [];
  return arr.filter((q): q is string => typeof q === 'string').slice(0, 10);
}
