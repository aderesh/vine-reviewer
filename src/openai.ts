import type { ProductInfo, GeneratedReview } from './types';
import { getSettings } from './storage';
import { DEFAULT_REVIEW_PROMPT } from './prompts';

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(
  template: string,
  product: ProductInfo,
  userNotes: string,
  starRating: number,
): string {
  return template
    .replace('{productTitle}', product.title)
    .replace('{features}', product.features.map((f) => `• ${f}`).join('\n') || 'N/A')
    .replace('{description}', product.description || 'N/A')
    .replace('{userNotes}', userNotes)
    .replace('{starRating}', String(starRating));
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

export async function generateReview(
  product: ProductInfo,
  userNotes: string,
  starRating: number,
): Promise<GeneratedReview> {
  const settings = await getSettings();

  if (!settings.openaiApiKey) {
    throw new Error(
      'API key is not set. Open the extension options and add your key.',
    );
  }

  const endpoint = (settings.apiEndpoint || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  const model = settings.openaiModel || 'llama-3.3-70b-versatile';

  const userPrompt = buildPrompt(
    settings.reviewPromptTemplate || DEFAULT_REVIEW_PROMPT,
    product,
    userNotes,
    starRating,
  );

  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.openaiApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: settings.systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 900,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(
      `OpenAI API error ${response.status}: ${err?.error?.message ?? response.statusText}`,
    );
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error('Empty response from OpenAI. Try regenerating.');
  }

  // Strip markdown code fences if the model wrapped the JSON
  const jsonStr = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

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
        inString = false;
        result += ch;
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
