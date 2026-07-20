import { Context, MiddlewareFn } from "grammy";

import { VacancyDatabase } from "../db/database";
import { logger } from "../logger";
import { BotUser } from "../types";

export const DISABLED_USER_MESSAGE = "⛔ Доступ к боту отключён.";

type PublicUserRegisteredHandler = (ctx: Context, user: BotUser) => Promise<void> | void;

type PublicAccessMiddlewareOptions = {
  onPublicUserRegistered?: PublicUserRegisteredHandler;
};

export async function denyAccess(ctx: Pick<Context, "callbackQuery" | "answerCallbackQuery" | "reply">): Promise<void> {
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({
      text: DISABLED_USER_MESSAGE
    });
    return;
  }

  await ctx.reply(DISABLED_USER_MESSAGE);
}

export function createPublicAccessMiddleware(
  database: VacancyDatabase,
  options: PublicAccessMiddlewareOptions = {}
): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (fromId === undefined || fromId === null) {
      await next();
      return;
    }

    const registration = database.registerPublicUserIfNeeded(fromId);
    if (registration?.user.isActive) {
      if (registration.created && options.onPublicUserRegistered) {
        const user = registration.user;
        const handleNotificationError = (error: unknown) => {
          logger.warn(
            {
              err: error,
              userId: user.userId
            },
            "Failed to handle public user registration notification."
          );
        };

        try {
          void Promise.resolve(options.onPublicUserRegistered(ctx, user)).catch(handleNotificationError);
        } catch (error) {
          handleNotificationError(error);
        }
      }

      await next();
      return;
    }

    if (ctx.callbackQuery || (ctx.message && "text" in ctx.message && ctx.message.text?.startsWith("/"))) {
      await denyAccess(ctx);
    }
  };
}
