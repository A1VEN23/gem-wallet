import os
import logging
from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, MenuButtonWebApp
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes, MessageHandler, filters

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Настройки ──────────────────────────────────────────────────────────────────
BOT_TOKEN  = os.getenv("BOT_TOKEN", "8617702690:AAHEEzFWLb9LPxhCKVtkw7P00vQ2FeJWxNo")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://gem-wallet-xxxx.vercel.app")  # ← вставь свой URL
ADMIN_ID   = 1192740493  # ID администратора — только он видит /admin команду
# ──────────────────────────────────────────────────────────────────────────────

WELCOME_TEXT = (
    "👋 Добро пожаловать в *Gem Wallet*\\!\n\n"
    "Это твой личный некастодиальный криптокошелёк прямо в Telegram\\.\n\n"
    "🔐 *Только ты владеешь своими ключами* — никаких посредников\\.\n\n"
    "Поддерживаемые сети:\n"
    "ETH · TON · BNB · SOL · LTC и другие\n\n"
    "Нажми кнопку 💎 *Gem* ниже, чтобы открыть кошелёк 👇"
)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    user = update.effective_user

    # Устанавливаем кнопку меню (левая кнопка рядом с полем ввода)
    await context.bot.set_chat_menu_button(
        chat_id=chat_id,
        menu_button=MenuButtonWebApp(
            text="💎 Gem",
            web_app=WebAppInfo(url=WEBAPP_URL)
        )
    )

    # Главная кнопка для открытия кошелька
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[
            InlineKeyboardButton("💎 Открыть Gem Wallet", web_app=WebAppInfo(url=WEBAPP_URL))
        ]]
    )

    img_path = os.path.join(os.path.dirname(__file__), "welcome.png")
    try:
        with open(img_path, "rb") as img:
            await context.bot.send_photo(
                chat_id=chat_id,
                photo=img,
                caption=WELCOME_TEXT,
                parse_mode="MarkdownV2",
                reply_markup=keyboard,
            )
    except FileNotFoundError:
        await context.bot.send_message(
            chat_id=chat_id,
            text=WELCOME_TEXT,
            parse_mode="MarkdownV2",
            reply_markup=keyboard,
        )

    logger.info(f"User {user.id} (@{user.username}) started the bot")


async def admin_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда /admin — только для администратора"""
    user = update.effective_user
    if user.id != ADMIN_ID:
        await update.message.reply_text("У вас нет доступа к этой команде.")
        return

    admin_url = WEBAPP_URL + "?admin=1"
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[
            InlineKeyboardButton("👑 Открыть Admin Panel", web_app=WebAppInfo(url=admin_url))
        ]]
    )
    await update.message.reply_text(
        "👑 Admin Panel\n\nДобро пожаловать, администратор!",
        reply_markup=keyboard,
    )


def main():
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("admin", admin_cmd))
    logger.info("Gem Wallet Bot started...")
    app.run_polling()


if __name__ == "__main__":
    main()
