import { ComplexityTier, ChatCompletionRequest } from '../types.js';

export interface ClassificationResult {
  tier: ComplexityTier;
  confidence: number;
  scores: Record<string, number>;
}

const DIMENSIONS = {
  codePresence: 0.15,
  reasoningMarkers: 0.18,
  technicalTerms: 0.10,
  creativeIndicators: 0.08,
  constraintWords: 0.07,
  multiStepPatterns: 0.08,
  agenticSignals: 0.06,
  tokenCount: 0.08,
  questionComplexity: 0.05,
  languageComplexity: 0.05,
  domainSpecificity: 0.04,
  outputFormatting: 0.02,
  contextLength: 0.02,
  toolUseSignals: 0.02,
} as const;

const THRESHOLDS = {
  simpleMedium: 0.15,
  mediumComplex: 0.28,
  complexReasoning: 0.55,
};

const CONFIDENCE_THRESHOLD = 0.7;

function sigmoid(x: number, center: number = 0.5, steepness: number = 10): number {
  return 1 / (1 + Math.exp(-steepness * (x - center)));
}

/** Extract all text content from messages as a single string. */
function extractText(request: ChatCompletionRequest): string {
  return request.messages
    .map((m) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .map((part: Record<string, unknown>) =>
            typeof part === 'string' ? part : (part.text as string) ?? '',
          )
          .join(' ');
      }
      return '';
    })
    .join('\n');
}

/** Rough token estimate (words * 1.3). */
function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

function countMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const p of patterns) {
    const matches = text.match(p);
    if (matches) count += matches.length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Dimension scorers — each returns 0-1
// ---------------------------------------------------------------------------

function scoreCodePresence(text: string): number {
  const patterns = [
    /```[\s\S]*?```/g,
    /\b(function|class|import|export|const|let|var|def|fn|func|pub|private|protected)\b/gi,
    /[a-zA-Z_]\w*\([^)]*\)/g, // function calls
    /[a-zA-Z_]\w*\.\w+/g, // dot access
    /\/[\w./]+\.\w{1,5}\b/g, // file paths
    /\b(if|else|for|while|return|switch|case|try|catch)\b/gi,
    // Code-request language (asking for code, not containing code)
    /\b(implement|write\s+a?\s*(?:function|class|method|script|program|code)|code\s+(?:that|to|for)|unit\s+test|error\s+handling|type\s+hint|edge\s+case|refactor|debug|compile|runtime|syntax|binary\s+search|linked\s+list|data\s+structure|sort\s+algorithm)\b/gi,
    /\b(Python|JavaScript|TypeScript|Java|C\+\+|Rust|Go|Ruby|Swift|Kotlin|PHP|Perl|Scala|Haskell|SQL)\b/g,
  ];
  const hits = countMatches(text, patterns);
  return Math.min(hits / 6, 1);
}

function scoreReasoningMarkers(text: string): number {
  const patterns = [
    /\b(prove|derive|analyze|compare|evaluate|explain\s+why|step\s+by\s+step|reason|justify|deduce|infer|critique|assess|contrast)\b/gi,
    /\b(think\s+through|break\s+down|walk\s+me\s+through|elaborate|in\s+depth)\b/gi,
    // CJK reasoning markers
    /(\u8BF7\u8BE6\u7EC6|\u8BF7\u5206\u6790|\u8BF7\u89E3\u91CA|\u8BF7\u63A8\u5BFC|\u6B65\u9AA4|\u4E3A\u4EC0\u4E48|\u5206\u6790|\u8BC1\u660E|\u63A8\u7406|\u6BD4\u8F83)/g,
    // Japanese
    /(\u8AAC\u660E\u3057\u3066|\u5206\u6790\u3057\u3066|\u6BD4\u8F03\u3057\u3066|\u8A55\u4FA1\u3057\u3066|\u8A3C\u660E\u3057\u3066)/g,
    // Korean
    /(\uBD84\uC11D|\uC124\uBA85|\uBE44\uAD50|\uD3C9\uAC00|\uC99D\uBA85)/g,
  ];
  const hits = countMatches(text, patterns);
  return Math.min(hits / 5, 1);
}

function scoreTechnicalTerms(text: string): number {
  const patterns = [
    /\b(algorithm|architecture|database|API|protocol|encryption|backend|frontend|microservice|container|kubernetes|docker|CI\/CD|pipeline|OAuth|REST|GraphQL|SQL|NoSQL|TCP|UDP|HTTP|DNS|SSL|TLS|mutex|semaphore|thread|process|cache|queue|stack|heap|binary|hash|token|middleware|webhook|endpoint|schema|migration|deployment|latency|throughput|scalability|replication|sharding)\b/gi,
    /\b(insert|delete|search|sort|traverse|recursive|iterative|complexity|O\(|runtime|memory|pointer|node|tree|graph|array|linked\s+list|hashtable|index|operation|data\s+structure)\b/gi,
  ];
  const hits = countMatches(text, patterns);
  return Math.min(hits / 5, 1);
}

function scoreCreativeIndicators(text: string): number {
  const patterns = [
    /\b(write\s+a\s+story|write\s+a\s+poem|creative|imagine|design|brainstorm|invent|compose|narrative|fiction|screenplay|dialogue|metaphor|artistic|poetic)\b/gi,
  ];
  const hits = countMatches(text, patterns);
  return Math.min(hits / 3, 1);
}

function scoreConstraintWords(text: string): number {
  const patterns = [
    /\b(must|exactly|precisely|no\s+more\s+than|no\s+less\s+than|between\s+\d+\s+and\s+\d+|at\s+most|at\s+least|strictly|only|limit|constraint|require|mandatory|forbidden|not\s+allowed)\b/gi,
  ];
  const hits = countMatches(text, patterns);
  return Math.min(hits / 5, 1);
}

function scoreMultiStepPatterns(text: string): number {
  const patterns = [
    /\b(first|then|next|after\s+that|finally|step\s+\d|phase\s+\d)\b/gi,
    /^\s*\d+[\.)]\s/gm, // numbered lists
    /\b(subsequently|followed\s+by|once\s+that|before\s+that|in\s+parallel)\b/gi,
  ];
  const hits = countMatches(text, patterns);
  return Math.min(hits / 6, 1);
}

function scoreAgenticSignals(text: string): number {
  const patterns = [
    /\b(use\s+the\s+tool|call\s+the\s+function|search\s+for|execute|run\s+the|invoke|trigger|automate|schedule|monitor|deploy|fetch\s+from|query\s+the|scrape|crawl)\b/gi,
  ];
  const hits = countMatches(text, patterns);
  return Math.min(hits / 4, 1);
}

function scoreTokenCount(text: string): number {
  const tokens = estimateTokens(text);
  if (tokens < 50) return 0.1;
  if (tokens < 150) return 0.3;
  if (tokens < 300) return 0.5;
  if (tokens < 500) return 0.7;
  return 1.0;
}

function scoreQuestionComplexity(text: string): number {
  // Simple questions
  const simple = [
    /\b(what\s+is|who\s+is|when\s+did|where\s+is|define|what\s+does)\b/gi,
  ];
  const complex = [
    /\b(how\s+would\s+you\s+approach|what\s+are\s+the\s+tradeoffs|compare\s+and\s+contrast|what\s+would\s+happen\s+if|how\s+does\s+.+\s+affect|why\s+is\s+.+\s+better|discuss\s+the\s+implications|what\s+are\s+the\s+pros\s+and\s+cons)\b/gi,
    // Imperative complex tasks
    /\b(implement|build|create|develop|architect|design\s+a\s+system|write\s+a\s+(?:function|class|module|library|program|script))\b/gi,
    /\b(include\s+(?:proper|error|unit|test)|handle\s+(?:edge|corner)\s+cases?)\b/gi,
  ];
  const simpleHits = countMatches(text, simple);
  const complexHits = countMatches(text, complex);
  if (complexHits > 0) return Math.min(0.5 + complexHits * 0.25, 1);
  if (simpleHits > 0) return 0.2;
  return 0.3;
}

function scoreLanguageComplexity(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (sentences.length === 0) return 0;
  const avgLen =
    sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length;
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const unique = new Set(words).size;
  const diversity = words.length > 0 ? unique / words.length : 0;

  const lenScore = Math.min(avgLen / 30, 1);
  const divScore = diversity; // already 0-1 range
  return (lenScore + divScore) / 2;
}

function scoreDomainSpecificity(text: string): number {
  const patterns = [
    /\b(diagnosis|prognosis|symptom|pathology|pharmacology|contraindication|dosage|etiology)\b/gi,
    /\b(statute|jurisdiction|tort|plaintiff|defendant|litigation|precedent|amicus)\b/gi,
    /\b(hypothesis|empirical|regression|p-value|coefficient|variance|stochastic|Bayesian|eigenvalue|Fourier|Lagrangian)\b/gi,
    /\b(genome|protein|enzyme|mitochondria|chromosome|CRISPR|nucleotide)\b/gi,
  ];
  const hits = countMatches(text, patterns);
  return Math.min(hits / 4, 1);
}

function scoreOutputFormatting(text: string): number {
  const patterns = [
    /\b(JSON|CSV|XML|YAML|markdown|table|HTML|format\s+as|output\s+as|structured)\b/gi,
    /\b(bullet\s+points|numbered\s+list|columns|headers)\b/gi,
  ];
  const hits = countMatches(text, patterns);
  return Math.min(hits / 3, 1);
}

function scoreContextLength(request: ChatCompletionRequest): number {
  const count = request.messages.length;
  if (count <= 2) return 0.1;
  if (count <= 5) return 0.3;
  if (count <= 10) return 0.5;
  if (count <= 20) return 0.7;
  return 1.0;
}

function scoreToolUseSignals(text: string): number {
  const patterns = [
    /\b(tool|function\s+call|plugin|extension|MCP|tool_use|function_call|tools?\s*:)\b/gi,
    /\b(browse|web\s+search|file\s+system|read\s+file|write\s+file|code\s+interpreter)\b/gi,
  ];
  const hits = countMatches(text, patterns);
  return Math.min(hits / 3, 1);
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

export function classifyRequest(request: ChatCompletionRequest): ClassificationResult {
  const text = extractText(request);

  const scores: Record<string, number> = {
    codePresence: scoreCodePresence(text),
    reasoningMarkers: scoreReasoningMarkers(text),
    technicalTerms: scoreTechnicalTerms(text),
    creativeIndicators: scoreCreativeIndicators(text),
    constraintWords: scoreConstraintWords(text),
    multiStepPatterns: scoreMultiStepPatterns(text),
    agenticSignals: scoreAgenticSignals(text),
    tokenCount: scoreTokenCount(text),
    questionComplexity: scoreQuestionComplexity(text),
    languageComplexity: scoreLanguageComplexity(text),
    domainSpecificity: scoreDomainSpecificity(text),
    outputFormatting: scoreOutputFormatting(text),
    contextLength: scoreContextLength(request),
    toolUseSignals: scoreToolUseSignals(text),
  };

  // Compute weighted sum
  let weightedSum = 0;
  for (const [dim, weight] of Object.entries(DIMENSIONS)) {
    weightedSum += (scores[dim] ?? 0) * weight;
  }

  // Map to tier
  let tier: ComplexityTier;
  if (weightedSum < THRESHOLDS.simpleMedium) {
    tier = 'simple';
  } else if (weightedSum < THRESHOLDS.mediumComplex) {
    tier = 'medium';
  } else if (weightedSum < THRESHOLDS.complexReasoning) {
    tier = 'complex';
  } else {
    tier = 'reasoning';
  }

  // Confidence: how far the score is from the nearest boundary.
  // Scores deep inside a tier get high confidence; scores near a boundary get low.
  const boundaries = [THRESHOLDS.simpleMedium, THRESHOLDS.mediumComplex, THRESHOLDS.complexReasoning];
  let minDist = 1;
  for (const b of boundaries) {
    minDist = Math.min(minDist, Math.abs(weightedSum - b));
  }
  const confidence = sigmoid(minDist, 0.03, 15);

  // Low confidence on extreme tiers only: when we're unsure about simple or reasoning,
  // nudge toward the adjacent moderate tier (medium or complex respectively).
  if (confidence < CONFIDENCE_THRESHOLD) {
    if (tier === 'simple') tier = 'medium';
    else if (tier === 'reasoning') tier = 'complex';
  }

  return { tier, confidence, scores };
}
