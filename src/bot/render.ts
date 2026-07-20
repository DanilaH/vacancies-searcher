import { Context, InlineKeyboard } from "grammy";

export type BotPanelMode = "reply" | "edit";

export interface BotPanelOptions {
  reply_markup?: InlineKeyboard;
  parse_mode?: "HTML";
}

export async function replyOrEdit(
  ctx: Context,
  mode: BotPanelMode,
  text: string,
  options: BotPanelOptions = {}
): Promise<void> {
  if (mode === "edit" && ctx.callbackQuery) {
    await ctx.editMessageText(text, options);
    return;
  }

  await ctx.reply(text, options);
}
