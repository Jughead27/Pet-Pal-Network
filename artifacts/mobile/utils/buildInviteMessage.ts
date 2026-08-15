/**
 * Single source of truth for the invite share link + message.
 *
 * The link is embedded IN the message text. Web callers must therefore share
 * `text: message` only — never pass a separate `url` param to
 * navigator.share(): the Web Share API concatenates text and url in the
 * receiving app, which made the link appear twice (confirmed in WhatsApp).
 * Native Share.share({ message }) is unaffected (no separate url passed).
 */
export function buildInviteMessage(code: string): { link: string; message: string } {
  const link = `https://pshpsh.net/invite/${code}`;
  const message = `you're invited to pshpsh — follow pets, not people. it's brand new, and you're one of the first to see it. 🐾 ${link}`;
  return { link, message };
}
