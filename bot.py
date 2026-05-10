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
    "💎 *Gem Wallet* — ваш некастодиальный крипто-кошелёк прямо в Telegram.\n\n"
    "ETH · TON · BNB · SOL · LTC и другие сети в одном месте.\n"
    "Только вы владеете своими ключами — никаких посредников.\n\n"
    "Нажмите кнопку *💎 Gem* ниже 👇"
)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id

    # Кнопка внизу слева — точно как у Tonkeeper (ReplyKeyboard с WebApp)
    keyboard = ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton("💎 Gem", web_app=WebAppInfo(url=WEBAPP_URL))]],
        resize_keyboard=True,
        one_time_keyboard=False,
    )

    photo_path = os.path.join(os.path.dirname(__file__), "welcome.png")
    with open(photo_path, "rb") as photo:
        await context.bot.send_photo(
            chat_id=chat_id,
            photo=photo,
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
