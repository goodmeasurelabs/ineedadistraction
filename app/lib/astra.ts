// Opt-in game-code generation. Chat, QA and metadata still use Anthropic.
// Enable only after comparing playable outputs: GAME_CODE_PROVIDER=openai.
export function usesAstra(): boolean {
  const provider = process.env.GAME_CODE_PROVIDER ?? 'anthropic';
  if (provider !== 'anthropic' && provider !== 'openai') {
    throw new Error('GAME_CODE_PROVIDER must be anthropic or openai');
  }
  return provider === 'openai';
}

type ResponseContent = { type: string; text?: string };
type OpenAIResponse = {
  status?: string;
  incomplete_details?: { reason?: string };
  output?: { type: string; content?: ResponseContent[] }[];
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
};

export async function generateWithAstra(system: string, input: string, signal?: AbortSignal) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required when GAME_CODE_PROVIDER=openai');

  // Bound one attempt so a failed request does not consume the route's whole
  // execution window. User cancellation is forwarded to the provider as well.
  const timeout = AbortSignal.timeout(180_000);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-6-astra',
      instructions: system,
      input,
      reasoning: { effort: 'low' },
      max_output_tokens: 24000,
      store: false,
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (!response.ok) {
    // Never put a raw upstream response, prompt or credential into an error.
    throw Object.assign(new Error(`OpenAI generation failed (${response.status})`), { status: response.status });
  }
  const data = await response.json() as OpenAIResponse;
  const text = (data.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text ?? '')
    .join('');

  const truncated = data.status === 'incomplete' && data.incomplete_details?.reason === 'max_output_tokens';
  if (!truncated && (data.status !== 'completed' || !text)) {
    throw new Error('OpenAI did not return a complete game');
  }

  // Normalize at the boundary so both code-generation routes retain their
  // existing truncation checks, retry handling, HTML extraction and caching logs.
  return {
    content: [{ type: 'text' as const, text }],
    stop_reason: truncated ? 'max_tokens' : 'end_turn',
    usage: {
      input_tokens: data.usage?.input_tokens,
      output_tokens: data.usage?.output_tokens,
      cache_read_input_tokens: data.usage?.input_tokens_details?.cached_tokens ?? 0,
      cache_creation_input_tokens: 0,
    },
  };
}
