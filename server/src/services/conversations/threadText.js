// The recent thread (oldest → newest) for the AI prompt and for fact-checking quotes.
import ConversationMessage from '../../models/ConversationMessage.js';

export { threadAsText, inboundText } from './threadFormat.js';

export async function recentThread(conversationId, { limit = 20 } = {}) {
  const items = await ConversationMessage.find({ conversationId }).sort({ at: -1, _id: -1 }).limit(limit).select('direction body at suspectedInjection');
  return items.reverse();
}
