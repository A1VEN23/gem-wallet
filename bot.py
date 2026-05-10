import os
import logging
from telegram import Update, ReplyKeyboardMarkup, KeyboardButton, WebAppInfo
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Настройки ──────────────────────────────────────────────────────────────────
BOT_TOKEN  = os.getenv("BOT_TOKEN", "YOUR_BOT_TOKEN_HERE")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://gem-wallet-xxxx.vercel.app")  # ← вставь свой URL
# ──────────────────────────────────────────────────────────────────────────────

WELCOME_TEXT = (
    "💎 *Gem Wallet* — крипто в твоём Telegram\n\n"
    "Отправляй, храни и обменивай ETH, TON, BNB, SOL и другие — быстро и без посредников.\n"
    "Только ты владеешь своими ключами 🔐"
)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id

    keyboard = ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton("💎 Gem", web_app=WebAppInfo(url=WEBAPP_URL))]],
        resize_keyboard=True,
        one_time_keyboard=False,
    )

    gif_path = os.path.join(os.path.dirname(__file__), "welcome.gif")
    with open(gif_path, "rb") as gif:
        await context.bot.send_animation(
            chat_id=chat_id,
            animation=gif,
            caption=WELCOME_TEXT,
            parse_mode="Markdown",
            reply_markup=keyboard,
        )

def main():
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    logger.info("Bot started...")
    app.run_polling()

if __name__ == "__main__":
    main()
