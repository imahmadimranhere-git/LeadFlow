// A controlled error that is SAFE to show to the user.
export default class ApiError extends Error {
  constructor(statusCode, message, errors = []) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true;
  }

  static badRequest(message = 'Bad request', errors = []) {
    return new ApiError(400, message, errors);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message);
  }
  static forbidden(message = 'You do not have permission to do this') {
    return new ApiError(403, message);
  }
  // Use 404 (not 403) for other tenants' records → attackers can't learn that an id exists.
  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }
  static conflict(message = 'Resource already exists', errors = []) {
    return new ApiError(409, message, errors);
  }
  static tooMany(message = 'Too many requests, please try again later.') {
    return new ApiError(429, message);
  }
}
