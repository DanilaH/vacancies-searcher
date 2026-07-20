import type { Transformer } from "grammy";

export const disableTextLinkPreviews: Transformer = async (prev, method, payload, signal) => {
  if (method === "sendMessage" || method === "editMessageText") {
    Object.assign(payload, {
      link_preview_options: { is_disabled: true }
    });
  }

  return prev(method, payload, signal);
};
