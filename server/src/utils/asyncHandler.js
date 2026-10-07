// Wraps async controllers so any thrown error goes to the error middleware
// (Express 4 doesn't catch promise rejections by itself).
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export default asyncHandler;
