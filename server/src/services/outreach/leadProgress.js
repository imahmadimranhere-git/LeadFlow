// Moves a lead forward in the CRM after outreach events — never backwards (a converted lead stays converted).
// Shared by outreach (sending) and conversations (replies).
import Lead from '../../models/Lead.js';
import OutreachMessage from '../../models/OutreachMessage.js';

const FROM = {
  CONTACTED: ['NEW', 'QUALIFIED'],
  REPLIED: ['NEW', 'QUALIFIED', 'CONTACTED', 'FOLLOW_UP'],
  FOLLOW_UP: ['NEW', 'QUALIFIED', 'CONTACTED', 'REPLIED'],
};

export async function advanceLead(leadId, toStatus, extra = {}) {
  await Lead.updateOne({ _id: leadId, status: { $in: FROM[toStatus] || [] } }, { $set: { status: toStatus } });
  await Lead.updateOne({ _id: leadId }, { $set: { lastActivityAt: new Date(), ...extra } });
}

/** The lead answered → their latest sent message on this channel becomes REPLIED (if it was still waiting). */
export async function markLatestSentReplied(leadId, channel, at = new Date()) {
  const last = await OutreachMessage.findOne({ leadId, channel, status: { $in: ['SENT', 'FOLLOW_UP'] } }).sort({ sentAt: -1 }).select('_id');
  if (!last) return null;
  await OutreachMessage.updateOne({ _id: last._id, status: { $in: ['SENT', 'FOLLOW_UP'] } }, { $set: { status: 'REPLIED', repliedAt: at } });
  return last._id;
}
