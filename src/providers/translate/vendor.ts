/**
 * Shared vendor-prefix utilities for providers that use `vendor/model` naming
 * (e.g. BlockRun, Spraay).
 */

/** Add vendor prefix to model name. */
export function vendorPrefix(model: string): string {
  if (model.startsWith("claude")) {
    return `anthropic/${model}`;
  } else if (
    model.startsWith("gpt") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4")
  ) {
    return `openai/${model}`;
  } else if (model.startsWith("gemini")) {
    return `google/${model}`;
  } else if (model.startsWith("deepseek")) {
    return `deepseek/${model}`;
  } else if (model.startsWith("grok")) {
    return `xai/${model}`;
  } else if (model.startsWith("minimax")) {
    return `minimax/${model}`;
  } else {
    return model;
  }
}

/** Strip vendor prefix from model name. */
export function stripVendorPrefix(model: string): string {
  const prefixes = [
    "anthropic/",
    "openai/",
    "google/",
    "deepseek/",
    "xai/",
    "x-ai/",
    "minimax/",
  ];
  for (const prefix of prefixes) {
    if (model.startsWith(prefix)) {
      return model.slice(prefix.length);
    }
  }
  return model;
}

/**
 * Convert trailing version hyphens to dots: "anthropic/claude-opus-4-6" -> "anthropic/claude-opus-4.6"
 *
 * Only converts when the last two hyphen-separated segments are all digits.
 */
export function hyphensToDots(model: string): string {
  // Find vendor/model split
  let prefix: string | undefined;
  let name: string;
  const slashIdx = model.indexOf("/");
  if (slashIdx !== -1) {
    prefix = model.slice(0, slashIdx);
    name = model.slice(slashIdx + 1);
  } else {
    prefix = undefined;
    name = model;
  }

  // Split from the right: we want up to 3 parts from the right side
  // rsplitn(3, '-') in Rust means split from right, max 3 parts
  const lastHyphen = name.lastIndexOf("-");
  if (lastHyphen === -1) {
    return model; // no hyphens at all
  }

  const lastPart = name.slice(lastHyphen + 1);
  const beforeLast = name.slice(0, lastHyphen);

  const secondLastHyphen = beforeLast.lastIndexOf("-");
  let secondLastPart: string;
  let rest: string;
  if (secondLastHyphen !== -1) {
    secondLastPart = beforeLast.slice(secondLastHyphen + 1);
    rest = beforeLast.slice(0, secondLastHyphen);
  } else {
    secondLastPart = beforeLast;
    rest = "";
  }

  const isAllDigits = (s: string) => s.length > 0 && /^\d+$/.test(s);

  if (isAllDigits(lastPart) && isAllDigits(secondLastPart)) {
    const converted =
      rest.length > 0
        ? `${rest}-${secondLastPart}.${lastPart}`
        : `${secondLastPart}.${lastPart}`;
    return prefix !== undefined ? `${prefix}/${converted}` : converted;
  }

  return model;
}

/** Convert trailing version dots to hyphens: "claude-opus-4.6" -> "claude-opus-4-6" */
export function dotsToHyphens(model: string): string {
  const dotPos = model.lastIndexOf(".");
  if (dotPos === -1) return model;

  const before = model.slice(0, dotPos);
  const after = model.slice(dotPos + 1);

  // Get the last segment before the dot (after the last hyphen)
  const lastHyphen = before.lastIndexOf("-");
  const beforeLast = lastHyphen !== -1 ? before.slice(lastHyphen + 1) : before;

  const isAllDigits = (s: string) => s.length > 0 && /^\d+$/.test(s);

  if (isAllDigits(beforeLast) && isAllDigits(after)) {
    return `${before}-${after}`;
  }

  return model;
}

/** Strip date suffix like `-20260205` from model names. */
export function stripDateSuffix(model: string): string {
  if (model.length > 9) {
    const suffix = model.slice(model.length - 9);
    if (suffix.startsWith("-") && /^\d{8}$/.test(suffix.slice(1))) {
      return model.slice(0, model.length - 9);
    }
  }
  return model;
}

/**
 * Normalize an upstream model name to canonical form.
 *
 * Steps: strip vendor prefix -> strip date suffix -> strip `-preview` suffix
 * -> convert dots->hyphens for Claude models.
 */
export function normalizeUpstreamModel(model: string): string {
  const stripped = stripVendorPrefix(model);
  const withoutDate = stripDateSuffix(stripped);
  const withoutPreview = withoutDate.endsWith("-preview")
    ? withoutDate.slice(0, -"-preview".length)
    : withoutDate;
  if (withoutPreview.startsWith("claude")) {
    return dotsToHyphens(withoutPreview);
  }
  return withoutPreview;
}
