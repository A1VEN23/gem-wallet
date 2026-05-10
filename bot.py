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
    "💎 *Добро пожаловать в Gem Wallet!*\n\n"
    "Ваш безопасный некастодиальный кошелёк для хранения и отправки криптовалют прямо в Telegram.\n\n"
    "✅ Только вы владеете своими ключами\n"
    "⛓ ETH, TON, BNB, SOL и другие сети\n"
    "🔒 Шифрование на уровне устройства\n\n"
    "Нажмите кнопку *Gem* ниже, чтобы открыть кошелёк 👇"
)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    chat_id = update.effective_chat.id

    # Кнопка WebApp — появляется внизу слева как у Tonkeeper
    keyboard = ReplyKeyboardMarkup(
        [[KeyboardButton("💎 Gem", web_app=WebAppInfo(url=WEBAPP_URL))]],
        resize_keyboard=True,
        one_time_keyboard=False,
        input_field_placeholder="Открыть кошелёк..."
    )

    # Отправляем картинку + текст + кнопку
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
    logger.info("Bot started. Waiting for /start...")
    app.run_polling()

if __name__ == "__main__":
    main()
