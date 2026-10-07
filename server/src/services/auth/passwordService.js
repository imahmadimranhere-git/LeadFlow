// Password hashing with bcrypt (cost 12). bcryptjs = pure JavaScript → installs on Windows without build tools.
import bcrypt from 'bcryptjs';

const COST = 12;
// Used when the email doesn't exist, so the response time is the same (prevents email guessing by timing)
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', COST);

export const hashPassword = (plain) => bcrypt.hash(plain, COST);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash || DUMMY_HASH);
export const burnTime = (plain) => bcrypt.compare(plain, DUMMY_HASH);
