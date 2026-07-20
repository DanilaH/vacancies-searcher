import { AppConfig } from "../config";

type FetchLike = typeof fetch;

export type ChannelProbeResult =
  | { ok: true; url: string }
  | { ok: false; url: string; error: string };

const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
};

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    const textSize = Buffer.byteLength(text, "utf8");
    if (textSize > maxBytes) {
      throw new Error(`HTTP response too large. Received ${textSize} bytes, limit is ${maxBytes}.`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(`HTTP response too large. Received more than ${maxBytes} bytes.`);
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function looksLikeChannelPreview(html: string, channel: string): boolean {
  return (
    html.includes(`data-post="${channel}/`) ||
    html.includes(`https://t.me/${channel}`) ||
    html.includes(`https://t.me/s/${channel}`) ||
    html.includes(`/s/${channel}`)
  );
}

export async function probeTelegramWebPreviewChannel(
  config: AppConfig,
  channel: string,
  fetchImpl: FetchLike = fetch
): Promise<ChannelProbeResult> {
  const url = `https://t.me/s/${channel}`;

  try {
    const response = await fetchImpl(url, {
      headers: DEFAULT_HEADERS,
      redirect: "error",
      signal: AbortSignal.timeout(config.webPreviewRequestTimeoutMs)
    });

    if (!response.ok) {
      return {
        ok: false,
        url,
        error: `Telegram preview returned HTTP ${response.status}.`
      };
    }

    const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declaredLength) && declaredLength > config.webPreviewMaxResponseBytes) {
      return {
        ok: false,
        url,
        error: `Telegram preview response is too large (${declaredLength} bytes).`
      };
    }

    const html = await readResponseText(response, config.webPreviewMaxResponseBytes);
    if (!looksLikeChannelPreview(html, channel)) {
      return {
        ok: false,
        url,
        error: "Похоже, это не публичная preview-страница канала или Telegram изменил HTML."
      };
    }

    return {
      ok: true,
      url
    };
  } catch (error) {
    return {
      ok: false,
      url,
      error: error instanceof Error ? error.message : "Не удалось проверить канал."
    };
  }
}
