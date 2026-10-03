import type { ChatMessage, ChatCompletionResponse, ChatCompletionChunk, Platform } from '@llmgateway/shared/types.js';
import { BaseProvider, type CompletionOptions, type KeyValidationResult } from './base.js';
import { type QuotaObservationContext } from '../services/provider-quota.js';
/**
 * Generic provider for platforms that use an OpenAI-compatible API.
 * Covers: Groq, Cerebras, NVIDIA NIM, Mistral, OpenRouter,
 * GitHub Models, Fireworks AI.
 */
export declare class OpenAICompatProvider extends BaseProvider {
    readonly platform: Platform;
    readonly name: string;
    private readonly baseUrl;
    private readonly extraHeaders;
    private readonly validateUrl?;
    /** Per-provider HTTP timeout override. OpenAI-compatible gateways often buffer
     * non-streaming responses until generation completes, and reasoning models can
     * take >15s before first byte. Default 60000. */
    private readonly timeoutMs;
    /** NVIDIA NIM models reject any request that permits parallel tool calls with
     * `400 This model only supports single tool-calls at once!`. When set, pin
     * parallel_tool_calls to false whenever tools are in play. See issue #255. */
    private readonly forceSingleToolCall;
    constructor(opts: {
        platform: Platform;
        name: string;
        baseUrl: string;
        extraHeaders?: Record<string, string>;
        validateUrl?: string;
        timeoutMs?: number;
        keyless?: boolean;
        forceSingleToolCall?: boolean;
    });
    /** Resolve the parallel_tool_calls flag to send upstream. For providers that
     * only accept single tool calls (NVIDIA NIM), force `false` whenever tools are
     * present so the model never tries to emit two at once and 400s; otherwise pass
     * the caller's value through unchanged. See issue #255. */
    private resolveParallelToolCalls;
    /** Some providers (Groq especially) reject a model's tool call with a 400
     * `tool_use_failed` when the model emitted it as inline DIALECT TEXT
     * (`<function=NAME{...}</function>`, Hermes/Qwen XML, etc.) that the provider's
     * own parser couldn't convert — but they hand back the raw text in
     * `error.failed_generation`. Weaker tool models (e.g. groq llama-3.3-70b) hit
     * this constantly, dead-ending an agent's whole turn even though the call is
     * perfectly recoverable. Reuse the same inline-dialect rescue the proxy already
     * applies to streamed text: parse `failed_generation` into structured
     * tool_calls so the turn succeeds instead of failing over (or exhausting the
     * chain when every enabled tool model behaves the same way). See issue #264. */
    private rescueFailedGeneration;
    /** Extract the useful text from an upstream error body. Most providers put it
     * at error.message, but NVIDIA NIM answers RFC7807-style ({"title": ...,
     * "detail": "Function id '...': DEGRADED function cannot be invoked"}) — the
     * old error.message-only read collapsed that to "Bad Request", so neither the
     * logs nor the error classifier could ever see the DEGRADED marker (#522). */
    private upstreamErrorText;
    /** Keyless providers (Kilo's anonymous free tier) must send NO Authorization
     * header — a stored sentinel like `Bearer no-key` could be treated as an
     * invalid key. Everyone else sends the bearer as usual. */
    private authHeader;
    /** Requesty's Leanstral route rejects greedy sampling when temperature=0.
     * Omitting that value and supplying a neutral top_p keeps the caller's intent
     * deterministic enough while using the provider's supported sampling path. */
    private samplingForModel;
    /** Mistral's OpenAI-compatible endpoint is strict about unknown nested fields
     * and returns 422 for provider-private replay fields that other gateways
     * ignore. Keep the OpenAI wire shape, but strip our internal reasoning /
     * thought-signature extensions before sending to Mistral. */
    private messagesForPlatform;
    chatCompletion(apiKey: string, messages: ChatMessage[], modelId: string, options?: CompletionOptions, quotaContext?: QuotaObservationContext): Promise<ChatCompletionResponse>;
    streamChatCompletion(apiKey: string, messages: ChatMessage[], modelId: string, options?: CompletionOptions, quotaContext?: QuotaObservationContext): AsyncGenerator<ChatCompletionChunk>;
    /** This provider's OpenAI-style model catalog URL. */
    get modelsUrl(): string;
    /**
     * GET a catalog-style endpoint with this provider's auth header, extra
     * headers, proxy routing, timeout policy and quota bookkeeping. Shared by
     * validateKey (which only reads the status) and custom-endpoint model
     * discovery (#488), which also reads the body — one place owns how we talk
     * to a provider's /models route.
     *
     * Note: transport errors (DNS / timeout / TLS) propagate to the caller.
     * health.ts catches them and marks status='error' WITHOUT incrementing the
     * consecutive-failure counter — only confirmed 401/403 disables a key.
     */
    protected fetchCatalogEndpoint(url: string, apiKey: string, quotaContext?: QuotaObservationContext): Promise<Response>;
    /** The raw `${baseUrl}/models` response, body unread. Used by custom-endpoint
     *  model discovery (#488); unlike validateKey it always hits /models, never a
     *  provider-specific validateUrl, because the caller wants the catalog. */
    fetchModelCatalog(apiKey: string, quotaContext?: QuotaObservationContext): Promise<Response>;
    validateKey(apiKey: string, quotaContext?: QuotaObservationContext): Promise<KeyValidationResult>;
}
//# sourceMappingURL=openai-compat.d.ts.map