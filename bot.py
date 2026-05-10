import os
import logging
from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, MenuButtonWebApp
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

    # Устанавливаем Menu Button (синяя кнопка слева от поля ввода — как у Tonkeeper)
    await context.bot.set_chat_menu_button(
        chat_id=chat_id,
        menu_button=MenuButtonWebApp(
            text="💎 Gem",
            web_app=WebAppInfo(url=WEBAPP_URL)
        )
    )

    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton("💎 Открыть Gem Wallet", web_app=WebAppInfo(url=WEBAPP_URL))]]
    )

    img_path = os.path.join(os.path.dirname(__file__), "welcome.png")
    with open(img_path, "rb") as img:
        await context.bot.send_photo(
            chat_id=chat_id,
            photo=img,
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
